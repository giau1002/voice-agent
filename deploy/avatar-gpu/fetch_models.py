"""Fetch only pinned MuseTalk inference assets; verify before loading checkpoints."""
import hashlib
import json
import shutil
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def safe_child(root, name):
    root = Path(root).resolve()
    result = (root / name).resolve()
    if result == root or not result.is_relative_to(root):
        raise ValueError(f'Path outside asset directory: {name}')
    return result


def file_digest(path, algorithm='sha256'):
    path = Path(path)
    digest = hashlib.sha1() if algorithm == 'git-sha1' else hashlib.sha256()
    if algorithm == 'git-sha1':
        digest.update(f'blob {path.stat().st_size}\0'.encode())
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify(path, info):
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(path)
    if 'size' in info and path.stat().st_size != info['size']:
        raise ValueError(f'Wrong file size: {path.name}')
    expected = info.get('digest', info.get('sha256'))
    if file_digest(path, info.get('algorithm', 'sha256')) != expected:
        raise ValueError(f'Checksum mismatch: {path.name}')


def unpack_source(archive_path, destination, revision):
    prefix = f'MuseTalk-{revision}/'
    with zipfile.ZipFile(archive_path) as archive:
        # Validate every entry before writing any file.
        entries = []
        for entry in archive.infolist():
            if not entry.filename.startswith(prefix):
                raise ValueError('Unexpected source archive root')
            relative = entry.filename[len(prefix):]
            if not relative:
                continue
            if stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError('Symlink in source archive')
            target = safe_child(destination, relative)
            entries.append((entry, target))
        for entry, target in entries:
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as source, target.open('wb') as output:
                    shutil.copyfileobj(source, output)


def main():
    from huggingface_hub import hf_hub_download
    manifest = json.loads((ROOT / 'models-manifest.json').read_text(encoding='utf-8'))
    archive = ROOT / 'musetalk-source.zip'
    verify(archive, manifest['source'])
    upstream = ROOT / '.runtime/MuseTalk'
    unpack_source(archive, upstream, manifest['source']['revision'])
    model_root = upstream / 'models'
    for index, item in enumerate(manifest['files'], 1):
        target = safe_child(model_root, item['path'])
        if target.is_file():
            try:
                verify(target, item)
                print(f'[{index}/{len(manifest["files"])}] Verified {item["path"]}', flush=True)
                continue
            except ValueError:
                raise ValueError(f'{target} is incomplete or changed. Move it aside before retrying.')
        remote_parts = Path(item['remote']).parts
        local_parts = Path(item['path']).parts
        if tuple(local_parts[-len(remote_parts):]) != tuple(remote_parts):
            raise ValueError('Manifest destination must preserve the remote filename')
        prefix = Path(*local_parts[:-len(remote_parts)])
        download_root = model_root if prefix == Path('.') else safe_child(model_root, prefix)
        print(f'[{index}/{len(manifest["files"])}] Downloading {item["path"]}', flush=True)
        hf_hub_download(repo_id=item['repo'], filename=item['remote'], revision=item['revision'],
                        local_dir=download_root, token=False)
        verify(target, item)
    print('All model checksums verified. Ready for pilot.', flush=True)


if __name__ == '__main__':
    main()
