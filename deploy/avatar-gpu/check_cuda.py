"""Small CUDA compatibility check, not an avatar performance benchmark."""
import argparse
import json
import platform
import time
from pathlib import Path


def check():
    report = {
        'schema': 'avatar-cuda-check-v1',
        'python': platform.python_version(),
        'system': platform.platform(),
        'ok': False,
        'scope': 'CUDA tensor/FP16/convolution only; MuseTalk not installed or benchmarked',
    }
    try:
        import torch
        report.update(torch=torch.__version__, torch_cuda=torch.version.cuda,
                      cuda_available=torch.cuda.is_available())
        if not torch.cuda.is_available():
            raise RuntimeError('PyTorch cannot access CUDA on this machine.')
        torch.cuda.set_device(0)
        # Limit this probe's caching allocator; do not compete for all VRAM.
        torch.cuda.set_per_process_memory_fraction(.1, 0)
        free, total = torch.cuda.mem_get_info(0)
        report.update(gpu=torch.cuda.get_device_name(0),
                      compute_capability=list(torch.cuda.get_device_capability(0)),
                      vram_total_mib=round(total / 1024**2),
                      vram_free_before_mib=round(free / 1024**2))
        if free < 1024**3:
            raise RuntimeError('Less than 1 GiB VRAM free. Probe stopped without running tensor checks.')
        torch.cuda.reset_peak_memory_stats(0)
        with torch.inference_mode():
            matrix = torch.randn(512, 512, device='cuda')
            reference = matrix @ matrix.T
            half = matrix.half()
            approximate = (half @ half.T).float()
            error = ((reference - approximate).norm() / reference.norm()).item()
            if not torch.isfinite(approximate).all().item() or error > .02:
                raise RuntimeError(f'FP16 result failed validation: relative_error={error}')
            conv = torch.nn.Conv2d(3, 16, 3, padding=1).cuda().half()
            pixels = torch.randn(1, 3, 256, 256, device='cuda', dtype=torch.float16)
            for _ in range(3):
                result = conv(pixels)
            torch.cuda.synchronize()
            started = time.perf_counter()
            for _ in range(10):
                result = conv(pixels)
            torch.cuda.synchronize()
            if not torch.isfinite(result).all().item():
                raise RuntimeError('Convolution returned non-finite values.')
            report.update(fp16_relative_error=error,
                          small_conv_ms=round((time.perf_counter() - started) * 100, 3),
                          torch_peak_allocated_mib=round(torch.cuda.max_memory_allocated(0) / 1024**2, 2),
                          cudnn_version=torch.backends.cudnn.version(), ok=True)
    except Exception as exc:
        report['error'] = f'{type(exc).__name__}: {exc}'
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('cuda-report.json'))
    args = parser.parse_args()
    report = check()
    output = json.dumps(report, ensure_ascii=False, indent=2)
    args.output.write_text(output + '\n', encoding='utf-8')
    print(output)
    return 0 if report['ok'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
