"""Evaluate real frames and warm chunk costs; MP4 is a review artifact only."""
import argparse
import html
import json
import math
import platform
import subprocess
import time
import uuid
import wave
from datetime import datetime
from pathlib import Path

import numpy as np
from assets import prepare_source, verify, verify_models
from engine import FlashHeadEngine
from PIL import Image
from scipy.signal import resample_poly
from streaming import PcmChunker, playout_estimate

ROOT = Path(__file__).resolve().parent


def read_audio(path, max_seconds=20):
    with wave.open(str(path), 'rb') as audio:
        if audio.getsampwidth() != 2 or audio.getnchannels() not in (1, 2):
            raise ValueError('Use PCM16 mono/stereo WAV')
        rate = audio.getframerate()
        channels = audio.getnchannels()
        if rate < 8000 or rate > 96000:
            raise ValueError('Unsupported sample rate')
        samples = np.frombuffer(audio.readframes(rate * max_seconds), dtype='<i2')
    samples = samples.astype(np.float32).reshape(-1, channels).mean(axis=1) / 32768
    factor = math.gcd(rate, 16000)
    samples = resample_poly(samples, 16000 // factor, rate // factor)
    if len(samples) < 16000:
        raise ValueError('Use at least one second of audio')
    return np.clip(samples * 32768, -32768, 32767).astype('<i2').tobytes()


def write_wav(path, pcm):
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(pcm)


def write_review(output, frame_groups, expected_frames, fps):
    """Encode the diagnostic recording outside the measured generation path."""
    import imageio.v2 as imageio
    import imageio_ffmpeg

    written = 0
    with imageio.get_writer(str(output / 'silent.mp4'), fps=fps, codec='libx264',
                            ffmpeg_params=['-bf', '0']) as writer:
        for group in frame_groups:
            for frame in group:
                if written >= expected_frames:
                    break
                writer.append_data(frame)
                written += 1
    if written != expected_frames:
        raise RuntimeError(f'Received {written} frames; expected {expected_frames}')
    # Both inputs are already bounded. -shortest can drop the final picture when
    # the WAV ends between frame boundaries (including our 6.495-second sample).
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-i', str(output/'silent.mp4'),
                    '-i', str(output/'speech.wav'), '-map', '0:v:0', '-map', '1:a:0',
                    '-c:v', 'copy', '-c:a', 'aac',
                    '-movflags', '+faststart', str(output/'review.mp4')],
                   check=True, capture_output=True)
    reader = imageio.get_reader(str(output/'review.mp4'))
    try:
        decoded = sum(1 for _ in reader)
    finally:
        reader.close()
    if decoded != expected_frames:
        raise RuntimeError(f'Encoded {decoded} frames; expected {expected_frames}')
    return decoded


def write_page(output, report):
    video = '<video controls src="review.mp4"></video>' if (output / 'review.mp4').exists() else ''
    details = html.escape(json.dumps(report, ensure_ascii=False, indent=2))
    page = f'''<!doctype html><html lang="vi"><meta charset="utf-8">
<title>Đánh giá avatar tự chạy</title><style>
body{{font:16px system-ui;background:#f3f7fc;color:#173456;margin:32px auto;max-width:1050px;padding:0 20px}}
.media{{display:flex;gap:16px;flex-wrap:wrap}}img,video{{width:min(100%,480px);border-radius:14px}}
pre{{background:white;border:1px solid #dbe6f2;padding:20px;overflow:auto;border-radius:14px}}
</style><h1>FlashHead Lite — bản đánh giá</h1>
<p>Kiểm tra môi, răng, khuôn mặt, chớp mắt và chuyển động đầu. Video này là bản ghi
để xem chất lượng; chưa phải chatbot LiveKit hay phép đo độ trễ trình duyệt.</p>
<div class="media"><img src="portrait-input.png" alt="Ảnh chân dung đầu vào">{video}</div>
<p>So sánh cùng lời nói với bản 2D. Không coi FPS cao là chất lượng đạt.</p>
<pre>{details}</pre></html>'''
    (output / 'index.html').write_text(page, encoding='utf-8')


def benchmark(args, output, report):
    import torch

    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    input_manifest = json.loads((ROOT / 'inputs/manifest.json').read_text(encoding='utf-8'))
    verify(ROOT / 'inputs/portrait.png', input_manifest['portrait'])
    if args.audio is None:
        verify(ROOT / 'inputs/speech-vi.wav', input_manifest['speech'])
    # One framing of the entire head and upper shoulders, never a pasted mouth.
    portrait = Image.open(ROOT / 'inputs/portrait.png').convert('RGB')
    if list(portrait.size) != input_manifest['dimensions']:
        raise ValueError('Unexpected portrait dimensions')
    portrait.crop(tuple(input_manifest['portrait_crop'])).resize(
        (512, 512), Image.Resampling.LANCZOS).save(output / 'portrait-input.png')
    pcm = read_audio(args.audio or ROOT / 'inputs/speech-vi.wav')
    write_wav(output / 'speech.wav', pcm)
    report['source_revision'] = manifest['source']['revision']
    report['audio_seconds'] = len(pcm) / 32000
    report['input_crop'] = input_manifest['portrait_crop']
    report['quality_accepted'] = None
    report['livekit_integrated'] = False
    report['av_sync_measured_in_browser'] = False
    report['attention'] = 'upstream PyTorch SDPA fallback; torch.compile disabled'
    prepare_source(ROOT, manifest)
    verify_models(ROOT, manifest)
    engine = FlashHeadEngine(ROOT, output / 'portrait-input.png', args.max_vram_gib)
    report.update(gpu=torch.cuda.get_device_name(), torch=torch.__version__,
                  free_before_mib=engine.free_before_bytes / 1024**2,
                  allocator_limit_mib=engine.memory_limit_bytes / 1024**2,
                  model_load_seconds=engine.model_load_seconds,
                  portrait_prepare_seconds=engine.prepare_seconds,
                  output_fps=engine.fps, output_frames_per_chunk=engine.output_frames,
                  chunk_seconds=engine.chunk_samples / engine.sample_rate)
    chunker = PcmChunker(engine.chunk_samples)
    # Deliberately feed transport-sized fragments, including uneven boundaries.
    chunks = []
    for i in range(0, len(pcm), 641):
        chunks.extend(chunker.push(pcm[i:i+641]))
    chunks.extend(chunker.finish())
    print('Warming up the model with one real audio chunk...', flush=True)
    warmup = engine.render(chunks[0])
    report['warmup_seconds'] = warmup.processing_seconds
    del warmup
    report['trials'] = []
    expected_frames = math.ceil(len(pcm) / 2 / engine.sample_rate * engine.fps)
    for trial in range(args.repeats):
        engine.reset(0)
        records = []
        record_frames = []
        for i, chunk in enumerate(chunks):
            rendered = engine.render(chunk)
            records.append({
                'index': i, 'offset_samples': rendered.sample_offset,
                'valid_samples': rendered.valid_samples,
                'audio_features_s': rendered.feature_seconds,
                'generate_s': rendered.render_seconds,
                'cpu_transfer_s': rendered.transfer_seconds,
                'processing_s': rendered.processing_seconds,
            })
            if trial == 0:
                record_frames.append(rendered.frames)
            print(f'Trial {trial+1}, chunk {i+1}/{len(chunks)}: '
                  f'{rendered.processing_seconds:.3f}s for 0.96s of output', flush=True)
        costs = [item['processing_s'] for item in records]
        full_seconds = len(costs) * report['chunk_seconds']
        report['trials'].append({
            'chunks': records,
            'render_fps_including_features_and_transfer': len(costs)*engine.output_frames/sum(costs),
            'rtf_compute_over_output': sum(costs)/full_seconds,
            'p95_chunk_s': float(np.percentile(costs, 95)),
            'pcm_at_1x_simulation': playout_estimate(costs, report['chunk_seconds']),
            'pcm_ready_upfront_simulation': playout_estimate(
                costs, report['chunk_seconds'], input_realtime=False),
        })
        if trial == 0:
            # Encode only AFTER timing the entire trial. Disk writes are never
            # interleaved with chunk timing or advertised as streaming transport.
            started = time.perf_counter()
            report['review_frames_decoded'] = write_review(
                output, record_frames, expected_frames, engine.fps)
            report['review_encode_verify_s'] = time.perf_counter() - started
            del record_frames
    report['torch_peak_reserved_mib'] = torch.cuda.max_memory_reserved()/1024**2
    report['torch_peak_allocated_mib'] = torch.cuda.max_memory_allocated()/1024**2
    report['execution_ok'] = True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audio', type=Path)
    parser.add_argument('--repeats', type=int, choices=[1, 2, 3], default=2)
    parser.add_argument('--max-vram-gib', type=float, default=16.0)
    args = parser.parse_args()
    if not 8 <= args.max_vram_gib <= 20:
        parser.error('max-vram-gib must be 8..20')
    output = ROOT / 'outputs' / (datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:6])
    output.mkdir(parents=True)
    report = {'schema': 'flashhead-feasibility-v1', 'execution_ok': False,
              'system': platform.platform(), 'python': platform.python_version(),
              'scope': 'warm single-GPU chunk benchmark and recorded quality sample; '
                       'not an end-to-end chatbot benchmark'}
    started = time.perf_counter()
    try:
        benchmark(args, output, report)
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
        raise
    finally:
        report['total_wall_s'] = time.perf_counter() - started
        (output/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                        encoding='utf-8')
        write_page(output, report)
        print(f'Result: {output}', flush=True)


if __name__ == '__main__':
    main()
