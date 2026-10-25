"""One persistent FlashHead Lite instance, yielding paired PCM and RGB chunks.

Serial, one session only. This adapter is NOT yet connected to the voice agent.
No PNG/MP4 work occurs in the render path. Never share its motion cache across users.
"""
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from streaming import AudioChunk


@dataclass
class RenderedChunk:
    epoch: int
    sample_offset: int
    valid_samples: int
    pcm: bytes
    frames: np.ndarray
    feature_seconds: float
    render_seconds: float
    transfer_seconds: float

    @property
    def processing_seconds(self):
        return self.feature_seconds + self.render_seconds + self.transfer_seconds


class FlashHeadEngine:
    def __init__(self, root: Path, image: Path, max_vram_gib=16.0):
        import torch

        self.torch = torch
        if not torch.cuda.is_available():
            raise RuntimeError('Requires NVIDIA CUDA. This local CPU machine cannot benchmark it.')
        free, total = torch.cuda.mem_get_info()
        if free < 14 * 1024**3:
            raise RuntimeError(f'Need at least 14 GiB free for this experiment; free={free/1024**3:.1f}')
        if not torch.cuda.is_bf16_supported():
            raise RuntimeError('The selected GPU must support BF16')
        limit = min(max_vram_gib * 1024**3, free - 2 * 1024**3)
        torch.cuda.set_per_process_memory_fraction(limit / total)
        self.memory_limit_bytes = int(limit)
        self.free_before_bytes = free
        # torch.compile/Triton and distributed kernels are deliberately omitted on
        # Windows. Hence the upstream 96 FPS figure is NOT a performance promise.
        upstream = (root / '.runtime/FlashHead').resolve()
        sys.path.insert(0, str(upstream))
        old_cwd = Path.cwd()
        try:
            os.chdir(upstream)
            from flash_head import inference
            from flash_head.src.pipeline import flash_head_pipeline

            flash_head_pipeline.COMPILE_MODEL = False
            flash_head_pipeline.COMPILE_VAE = False
            self.api = inference
            started = time.perf_counter()
            self.pipeline = inference.get_pipeline(
                world_size=1, model_type='lite',
                ckpt_dir=(root / '.runtime/models/flashhead').resolve().as_posix(),
                wav2vec_dir=(root / '.runtime/models/wav2vec2').resolve().as_posix(),
            )
            self.pipeline.audio_encoder.eval()
            torch.cuda.synchronize()
            self.model_load_seconds = time.perf_counter() - started
            started = time.perf_counter()
            inference.get_base_data(self.pipeline, image.resolve().as_posix(), 42, False)
            torch.cuda.synchronize()
            self.prepare_seconds = time.perf_counter() - started
        finally:
            os.chdir(old_cwd)
        params = self.api.get_infer_params()
        self.fps = params['tgt_fps']
        self.sample_rate = params['sample_rate']
        self.motion_frames = params['motion_frames_num']
        self.output_frames = params['frame_num'] - self.motion_frames
        self.chunk_samples = self.output_frames * self.sample_rate // self.fps
        if (self.fps, self.sample_rate, self.output_frames, self.chunk_samples) != (25, 16000, 24, 15360):
            raise ValueError('Unexpected upstream timing; revalidate the streaming adapter')
        self.cache_samples = params['cached_audio_duration'] * self.sample_rate
        self.audio_end = params['cached_audio_duration'] * self.fps
        self.audio_start = self.audio_end - params['frame_num']
        self.reset(0)

    def reset(self, epoch, preserve_motion=False):
        # This research runner starts each trial from the original pose. A future
        # conversational service must transition smoothly between speaking/idle.
        self.epoch = epoch
        self.next_sample = 0
        self.audio_cache = np.zeros(self.cache_samples, dtype=np.float32)
        if not preserve_motion:
            self.pipeline.reset_person_name()
            self.pipeline.generator.manual_seed(42)

    def render(self, chunk: AudioChunk):
        if chunk.epoch != self.epoch or chunk.sample_offset != self.next_sample:
            raise ValueError('Stale or out-of-order audio chunk')
        if len(chunk.pcm) != self.chunk_samples * 2:
            raise ValueError('Wrong PCM chunk length')
        if not 0 < chunk.valid_samples <= self.chunk_samples:
            raise ValueError('Invalid valid_samples')
        audio = np.frombuffer(chunk.pcm, dtype='<i2').astype(np.float32) / 32768.0
        self.audio_cache = np.concatenate([self.audio_cache[len(audio):], audio])
        self.torch.cuda.synchronize()
        started = time.perf_counter()
        features = self.api.get_audio_embedding(
            self.pipeline, self.audio_cache, self.audio_start, self.audio_end)
        self.torch.cuda.synchronize()
        feature_done = time.perf_counter()
        video = self.api.run_pipeline(self.pipeline, features)[self.motion_frames:]
        self.torch.cuda.synchronize()
        render_done = time.perf_counter()
        # Convert on GPU before PCIe transfer: 1 byte/channel instead of FP32.
        frames = video.to(self.torch.uint8).cpu().numpy()
        transferred = time.perf_counter()
        if frames.shape != (self.output_frames, 512, 512, 3):
            raise ValueError(f'Unexpected frame shape: {frames.shape}')
        self.next_sample += self.chunk_samples
        return RenderedChunk(chunk.epoch, chunk.sample_offset, chunk.valid_samples,
                             chunk.pcm, frames, feature_done-started,
                             render_done-feature_done, transferred-render_done)
