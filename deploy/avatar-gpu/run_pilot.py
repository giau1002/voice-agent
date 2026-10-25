"""Render a bounded Vietnamese lip-sync quality pilot using MuseTalk 1.5.

This is an offline model evaluation, not a streaming chatbot implementation.
The fixed face crop is calibrated only for the bundled portrait.
"""
import argparse
import datetime as dt
import html
import json
import os
import subprocess
import sys
import time
import uuid
import wave
from pathlib import Path

from fetch_models import safe_child, verify

ROOT = Path(__file__).resolve().parent


def validate_box(box, width, height):
    if len(box) != 4 or any(type(v) is not int for v in box):
        raise ValueError('Face box must contain four integer coordinates')
    x1, y1, x2, y2 = box
    if not 0 <= x1 < x2 <= width or not 0 <= y1 < y2 <= height:
        raise ValueError('Face box is outside the portrait')
    if min(x2 - x1, y2 - y1) < 64:
        raise ValueError('Face crop is too small')
    return x1, y1, x2, y2


def execute(command):
    subprocess.run([str(value) for value in command], check=True, stdin=subprocess.DEVNULL)


def write_preview(output, report):
    stats = html.escape(json.dumps(report, ensure_ascii=False, indent=2))
    page = '''<!doctype html><html lang="vi"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kiểm tra khẩu hình · MuseTalk</title><style>
body{font:16px/1.6 system-ui;margin:0;background:#edf4fb;color:#163653}
main{max-width:1080px;margin:auto;padding:24px}h1{font-size:26px;margin:0 0 10px}
.layout{display:grid;grid-template-columns:minmax(280px,480px) 1fr;gap:24px}
video{width:100%;max-height:75vh;background:#dce5ef;border-radius:18px}
article{background:white;border-radius:18px;padding:22px}pre{white-space:pre-wrap;word-break:break-word;font-size:12px}
@media(max-width:750px){.layout{grid-template-columns:1fr}}
</style><main><h1>Thử khẩu hình với giọng tiếng Việt</h1>
<p>Bước đánh giá mô hình. Chưa tích hợp vào chatbot trực tiếp.</p><div class="layout">
<video controls playsinline preload="metadata" src="pilot.mp4"></video>
<article><h2>Kiểm tra khi xem</h2><ul><li>Môi và răng có khớp tiếng nói không?</li>
<li>Má, cằm có biến dạng hoặc bị mờ không?</li><li>Miệng có nghỉ khi âm thanh ngắt không?</li></ul>
<p>Ở bản thử này, đầu và mắt giữ nguyên để đánh giá riêng khẩu hình. Không dùng kết quả này để kết luận chuyển động toàn bộ nhân vật đã tự nhiên.</p>
<details><summary>Báo cáo kỹ thuật</summary><pre>REPORT</pre></details></article></div></main></html>'''
    (output / 'index.html').write_text(page.replace('REPORT', stats), encoding='utf-8')


def render(args, output, report):
    import cv2
    import imageio_ffmpeg
    import numpy as np
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError('CUDA is required. Refusing to render this pilot on CPU.')
    torch.cuda.set_device(0)
    free, total = torch.cuda.mem_get_info(0)
    if free < 8 * 1024**3:
        raise RuntimeError('Less than 8 GiB VRAM available. Retry when free; no process was stopped.')
    budget = min(12 * 1024**3, free - 3 * 1024**3)
    torch.cuda.set_per_process_memory_fraction(budget / total, 0)
    torch.cuda.reset_peak_memory_stats(0)
    report.update(gpu=torch.cuda.get_device_name(0), torch=torch.__version__,
                  vram_free_before_mib=round(free / 1024**2),
                  allocator_limit_mib=round(budget / 1024**2), batch_size=args.batch_size,
                  precision='float16', fps=args.fps)
    source_manifest = json.loads((ROOT / 'inputs/manifest.json').read_text(encoding='utf-8'))
    portrait_path = ROOT / 'inputs/portrait.png'
    verify(portrait_path, source_manifest['portrait'])
    frame = cv2.imread(str(portrait_path))
    if frame is None:
        raise ValueError('Cannot decode portrait')
    height, width = frame.shape[:2]
    if [width, height] != source_manifest['dimensions']:
        raise ValueError('Unexpected portrait dimensions')
    box = validate_box(source_manifest['face_box'], width, height)
    x1, y1, x2, y2 = box
    audio = Path(args.audio).resolve() if args.audio else ROOT / 'inputs/speech-vi.wav'
    if not args.audio:
        verify(audio, source_manifest['speech'])
    if not audio.is_file():
        raise FileNotFoundError(audio)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    normalized = output / 'speech.wav'
    execute([ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', audio,
             '-t', '25', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', normalized])
    with wave.open(str(normalized)) as wav:
        seconds = wav.getnframes() / wav.getframerate()
    if not .5 <= seconds <= 25:
        raise ValueError('Need between 0.5 and 25 seconds of speech for this pilot')
    report.update(audio_seconds=seconds, input_max_seconds=25, face_box=list(box),
                  source_motion='static portrait; head/eyes intentionally held for mouth evaluation')

    upstream = ROOT / '.runtime/MuseTalk'
    manifest = json.loads((ROOT / 'models-manifest.json').read_text(encoding='utf-8'))
    for item in manifest['files']:
        verify(safe_child(upstream / 'models', item['path']), item)
    report['source_revision'] = manifest['source']['revision']
    sys.path.insert(0, str(upstream))
    os.chdir(upstream)
    # Upstream face parser uses relative model paths; working directory is this
    # private source tree. No source patch or shell-based FFmpeg invocation.
    from diffusers import UNet2DConditionModel
    from musetalk.models.unet import PositionalEncoding
    from musetalk.models.vae import VAE
    from musetalk.utils.audio_processor import AudioProcessor
    from musetalk.utils.blending import get_image_blending, get_image_prepare_material
    from musetalk.utils.face_parsing import FaceParsing
    from transformers import WhisperModel

    torch.manual_seed(13)
    started = time.perf_counter()
    with torch.inference_mode():
        config = json.loads((upstream / 'models/musetalkV15/musetalk.json').read_text())
        unet = UNet2DConditionModel(**config)
        # Load the verified checkpoint on CPU to avoid a second full GPU copy.
        weights = torch.load(upstream / 'models/musetalkV15/unet.pth', map_location='cpu', weights_only=True)
        unet.load_state_dict(weights)
        del weights
        unet = unet.eval().half().to('cuda')
        vae = VAE(model_path=str(upstream / 'models/sd-vae'))
        vae.vae = vae.vae.eval().half()
        pe = PositionalEncoding(d_model=384).eval().half().to('cuda')
        whisper = WhisperModel.from_pretrained(upstream / 'models/whisper', local_files_only=True).eval().half().to('cuda')
        whisper.requires_grad_(False)
        fp = FaceParsing(left_cheek_width=90, right_cheek_width=90)
        processor = AudioProcessor(feature_extractor_path=str(upstream / 'models/whisper'))
        torch.cuda.synchronize()
        report['model_load_seconds'] = round(time.perf_counter() - started, 3)
        started = time.perf_counter()
        face = cv2.resize(frame[y1:y2, x1:x2], (256, 256), interpolation=cv2.INTER_LANCZOS4)
        latent = vae.get_latents_for_unet(face).half()
        mask, crop_box = get_image_prepare_material(frame, box, fp=fp, mode='jaw')
        if np.count_nonzero(mask) < 100:
            raise RuntimeError('Face parser did not produce a usable mouth mask')
        torch.cuda.synchronize()
        report['portrait_preparation_seconds'] = round(time.perf_counter() - started, 3)
        cv2.imwrite(str(output / 'blend-mask.png'), mask)
        started = time.perf_counter()
        features, samples = processor.get_audio_feature(str(normalized), weight_dtype=torch.float16)
        chunks = processor.get_whisper_chunk(features, torch.device('cuda'), torch.float16,
                                             whisper, samples, fps=args.fps)
        torch.cuda.synchronize()
        report['audio_feature_seconds'] = round(time.perf_counter() - started, 3)
        frame_count = len(chunks)
        if not frame_count or frame_count > args.fps * 25:
            raise RuntimeError('Unexpected audio feature frame count')
        # A single warm-up batch is explicitly excluded from model-only timing.
        timestep = torch.tensor([0], device='cuda')
        warm = min(args.batch_size, frame_count)
        result = unet(latent.repeat(warm, 1, 1, 1), timestep,
                      encoder_hidden_states=pe(chunks[:warm].half())).sample
        vae.decode_latents(result)
        torch.cuda.synchronize()
        frames_dir = output / 'frames'
        frames_dir.mkdir()
        started = time.perf_counter()
        model_seconds, batch_ms = 0., []
        for offset in range(0, frame_count, args.batch_size):
            batch = chunks[offset:offset + args.batch_size].half()
            torch.cuda.synchronize()
            batch_started = time.perf_counter()
            result = unet(latent.repeat(len(batch), 1, 1, 1), timestep,
                          encoder_hidden_states=pe(batch)).sample
            decoded = vae.decode_latents(result)
            torch.cuda.synchronize()
            elapsed = time.perf_counter() - batch_started
            model_seconds += elapsed
            batch_ms.append(round(elapsed * 1000, 2))
            for index, generated in enumerate(decoded, start=offset):
                face = cv2.resize(generated.astype(np.uint8), (x2-x1, y2-y1), interpolation=cv2.INTER_LANCZOS4)
                combined = get_image_blending(frame, face, box, mask, crop_box)
                if not cv2.imwrite(str(frames_dir / f'{index:06d}.png'), combined):
                    raise OSError('Failed to write rendered frame')
            if offset % (args.batch_size * 10) == 0:
                print(f'Rendered {min(offset + len(batch), frame_count)}/{frame_count}', flush=True)
        complete_seconds = time.perf_counter() - started
        report.update(frames=frame_count, model_only_seconds=round(model_seconds, 3),
                      model_only_fps=round(frame_count / model_seconds, 2),
                      render_blend_write_seconds=round(complete_seconds, 3),
                      render_blend_write_fps=round(frame_count / complete_seconds, 2),
                      batch_latency_ms=batch_ms,
                      peak_scope='After CUDA preflight, including model load, preparation and warm-up',
                      torch_peak_reserved_mib=round(torch.cuda.max_memory_reserved(0) / 1024**2),
                      torch_peak_allocated_mib=round(torch.cuda.max_memory_allocated(0) / 1024**2))
    started = time.perf_counter()
    video = output / 'pilot.mp4'
    execute([ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
             '-framerate', args.fps, '-i', frames_dir / '%06d.png', '-i', normalized,
             '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-crf', '18',
             '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', video])
    report['encode_seconds'] = round(time.perf_counter() - started, 3)
    decoded_count = 0
    cap = cv2.VideoCapture(str(video))
    try:
        while True:
            ok, decoded = cap.read()
            if not ok:
                break
            if decoded.shape[:2] != (height, width):
                raise RuntimeError('Encoded video dimensions changed')
            decoded_count += 1
    finally:
        cap.release()
    if decoded_count != frame_count:
        raise RuntimeError(f'Output video lost frames: {decoded_count}/{frame_count}')
    report.update(ok=True, decoded_output_frames=decoded_count, output='pilot.mp4')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', help='Optional local audio; first 25 seconds only')
    parser.add_argument('--batch-size', type=int, choices=[1, 2, 4], default=2)
    parser.add_argument('--fps', type=int, choices=[25, 30], default=25)
    args = parser.parse_args()
    # Isolate caches; no provider keys or user account credentials are needed.
    for key, value in {'HF_HOME': str(ROOT / '.runtime/hf-cache'), 'HF_HUB_DISABLE_IMPLICIT_TOKEN': '1',
                       'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'CUDA_VISIBLE_DEVICES': '0'}.items():
        os.environ[key] = value
    run = dt.datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:6]
    output = ROOT / 'outputs' / run
    output.mkdir(parents=True)
    report = {'schema': 'musetalk-pilot-v1', 'ok': False, 'run': run,
              'scope': 'Offline lip-sync evaluation. No live streaming, head motion or kiosk integration.',
              'performance_note': 'Model FPS excludes loading, preparation, audio features, transport and playback.'}
    started = time.perf_counter()
    try:
        render(args, output, report)
    except Exception as exc:
        report['error'] = f'{type(exc).__name__}: {exc}'
        print(report['error'], file=sys.stderr)
    finally:
        report['elapsed_total_seconds'] = round(time.perf_counter() - started, 3)
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if report['ok']:
        write_preview(output, report)
        print(f'PILOT_READY {output}\nOpen index.html to review. Send pilot.mp4 and report.json.', flush=True)
    else:
        print(f'PILOT_FAILED {output / "report.json"}', flush=True)
    return 0 if report['ok'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
