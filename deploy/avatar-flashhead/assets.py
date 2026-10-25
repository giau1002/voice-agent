"""Pinned assets for the standalone FlashHead feasibility experiment."""
import argparse
import hashlib
import json
import shutil
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def child(root, relative):
    root = Path(root).resolve()
    target = (root / relative).resolve()
    if target == root or not target.is_relative_to(root):
        raise ValueError(f'Unsafe asset path: {relative}')
    return target


def digest(path, algorithm='sha256'):
    path = Path(path)
    value = hashlib.sha1() if algorithm == 'git-sha1' else hashlib.sha256()
    if algorithm == 'git-sha1':
        value.update(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb') as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def verify(path, item):
    if not Path(path).is_file():
        raise FileNotFoundError(path)
    if 'size' in item and Path(path).stat().st_size != item['size']:
        raise ValueError(f'Wrong file size: {path}')
    if digest(path, item.get('algorithm', 'sha256')) != item['digest']:
        raise ValueError(f'Checksum mismatch: {path}')


def extract(source, destination, prefix):
    with zipfile.ZipFile(source) as archive:
        entries = []
        for item in archive.infolist():
            if not item.filename.startswith(prefix):
                raise ValueError('Unexpected archive prefix')
            name = item.filename[len(prefix):]
            if not name:
                continue
            if stat.S_ISLNK(item.external_attr >> 16):
                raise ValueError('Symlink not accepted')
            entries.append((item, child(destination, name)))
        for item, target in entries:
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as src, target.open('wb') as dst:
                    shutil.copyfileobj(src, dst)


def patch_single_gpu(upstream):
    """Make distributed/cropping deps lazy. Leave model math/weights untouched.

    Single GPU uses upstream's existing PyTorch SDPA fallback. Distributed mode
    remains dependent on xfuser; we do not fake its functions or install NCCL.
    """
    edits = {
        'flash_head/src/modules/flash_head_model.py': (
            'from xfuser.core.distributed import (\n'
            '    get_sequence_parallel_rank,\n'
            '    get_sequence_parallel_world_size,\n'
            '    get_sp_group,\n)\n'
            'from xfuser.core.long_ctx_attention import xFuserLongContextAttention',
            '# voice-agent: single-GPU Windows compatibility, modified upstream.\n'
            'try:\n'
            '    from xfuser.core.distributed import (\n'
            '        get_sequence_parallel_rank, get_sequence_parallel_world_size, get_sp_group\n'
            '    )\n'
            '    from xfuser.core.long_ctx_attention import xFuserLongContextAttention\n'
            'except ModuleNotFoundError:\n'
            '    def _requires_xfuser(*args, **kwargs):\n'
            '        raise RuntimeError("This build supports one GPU; xfuser is not installed")\n'
            '    get_sequence_parallel_rank = _requires_xfuser\n'
            '    get_sequence_parallel_world_size = _requires_xfuser\n'
            '    get_sp_group = _requires_xfuser\n'
            '    xFuserLongContextAttention = _requires_xfuser',
        ),
        'flash_head/src/pipeline/flash_head_pipeline.py': (
            'from flash_head.utils.facecrop import process_image',
            '# voice-agent: prepared whole-portrait input needs no face detector.\n'
            'def process_image(*args, **kwargs):\n'
            '    from flash_head.utils.facecrop import process_image as crop\n'
            '    return crop(*args, **kwargs)',
        ),
    }
    for name, (old, new) in edits.items():
        path = child(upstream, name)
        source = path.read_text(encoding='utf-8')
        if new in source:
            continue
        if source.count(old) != 1:
            raise ValueError(f'Pinned source changed; cannot patch {name}')
        path.write_text(source.replace(old, new), encoding='utf-8')


def prepare_source(root, manifest):
    source = root / 'flashhead-source.zip'
    verify(source, manifest['source'])
    upstream = root / '.runtime/FlashHead'
    extract(source, upstream, manifest['source']['prefix'])
    patch_single_gpu(upstream)
    return upstream


def verify_models(root, manifest):
    for item in manifest['files']:
        verify(child(root / '.runtime/models', item['path']), item)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    if not args.verify_only:
        from huggingface_hub import hf_hub_download

        prepare_source(ROOT, manifest)
        for i, item in enumerate(manifest['files'], 1):
            target = child(ROOT / '.runtime/models', item['path'])
            if target.is_file():
                verify(target, item)
                continue
            remote = Path(item['remote'])
            destination = Path(item['path'])
            if destination.parts[-len(remote.parts):] != remote.parts:
                raise ValueError('Model destination must preserve remote name')
            prefix = Path(*destination.parts[:-len(remote.parts)])
            print(f'[{i}/{len(manifest["files"])}] {item["path"]}', flush=True)
            hf_hub_download(repo_id=item['repo'], filename=item['remote'],
                            revision=item['revision'], token=False,
                            local_dir=ROOT / '.runtime/models' / prefix)
    verify_models(ROOT, manifest)
    print('Pinned model checksums verified.')


if __name__ == '__main__':
    main()
