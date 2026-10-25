"""Package only reviewed GPU-probe files; never include .env or app credentials."""
import argparse
import hashlib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UV_SHA256 = 'bb701bd35b586c45966654ea2703c9bd116a6a4fc0a8ca755bd644c2c41c5ebe'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--uv-archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/avatar-gpu-check.zip')
    args = parser.parse_args()
    if hashlib.sha256(args.uv_archive.read_bytes()).hexdigest() != UV_SHA256:
        raise SystemExit('uv release checksum mismatch')
    files = {name: ROOT / 'deploy/avatar-gpu' / name for name in ('setup.ps1', 'check_cuda.py', 'README.md')}
    files['uv-windows.zip'] = args.uv_archive
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, source in files.items():
            archive.write(source, name)
    with zipfile.ZipFile(args.output) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(files)
    digest = hashlib.sha256(args.output.read_bytes()).hexdigest()
    args.output.with_suffix('.zip.sha256').write_text(f'{digest}  {args.output.name}\n', encoding='ascii')
    print(f'{args.output}: {args.output.stat().st_size} bytes\nSHA256 {digest}')


if __name__ == '__main__':
    main()
