"""Reproducible research kit: pinned public sources, no keys or paid services."""
import hashlib
import json
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / 'deploy/avatar-flashhead'
CACHE = ROOT / '.tools/avatar-research'
SOURCE_REVISION = '9bc03de06bb0de82cd6bc477804512ae06144bf2'
REPOSITORIES = {
    'Soul-AILab/SoulX-FlashHead-1_3B': (
        '5fbd2e44ba08ab2deb28bd55cff2c15523e51ba5', 'flashhead',
        ['Model_Lite/config.json', 'Model_Lite/diffusion_pytorch_model.safetensors',
         'VAE_LTX/config.json', 'VAE_LTX/diffusion_pytorch_model.safetensors', 'README.md']),
    'facebook/wav2vec2-base-960h': (
        '22aad52d435eb6dbaf354bdad9b0da84ce7d6156', 'wav2vec2',
        ['config.json', 'preprocessor_config.json', 'model.safetensors', 'README.md']),
}
NAMES = ['assets.py', 'engine.py', 'streaming.py', 'benchmark.py', 'smoke.py', 'setup.ps1',
         'run.ps1', 'requirements.txt', 'README.md', 'THIRD_PARTY.md', 'manifest.json',
         'service.py', 'serve.ps1', 'requirements-live.txt', 'LIVE.md']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    source_url = f'https://codeload.github.com/Soul-AILab/SoulX-FlashHead/zip/{SOURCE_REVISION}'
    source = CACHE / 'flashhead-source.zip'
    if not source.exists():
        with urllib.request.urlopen(source_url, timeout=90) as response:
            source.write_bytes(response.read())
    manifest = {
        'source': {'url': source_url, 'revision': SOURCE_REVISION, 'digest': sha(source),
                   'prefix': f'SoulX-FlashHead-{SOURCE_REVISION}/'}, 'files': [],
    }
    for repo, (revision, prefix, names) in REPOSITORIES.items():
        with urllib.request.urlopen(
            f'https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true', timeout=45
        ) as response:
            info = json.load(response)
        if info['sha'] != revision:
            raise ValueError('Unexpected model revision')
        for name in names:
            item = next(x for x in info['siblings'] if x['rfilename'] == name)
            lfs = item.get('lfs')
            manifest['files'].append({
                'repo': repo, 'revision': revision, 'remote': name, 'path': f'{prefix}/{name}',
                'size': item['size'], 'algorithm': 'sha256' if lfs else 'git-sha1',
                'digest': lfs['sha256'] if lfs else item['blobId'],
            })
    (KIT/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    files = {name: KIT / name for name in NAMES}
    files.update({
        'avatar_wire.py': ROOT/'voice_agent/avatar_wire.py',
        'flashhead-source.zip': source,
        'uv-windows.zip': Path(r'D:\Code\reverse\habbit\.rea\tools\uv\uv.zip'),
        'inputs/portrait.png': ROOT/'web/public/avatar/portrait.png',
        'inputs/speech-vi.wav': ROOT/'.tools/avatar-pilot/speech-vi.wav',
    })
    if sha(files['uv-windows.zip']) != 'bb701bd35b586c45966654ea2703c9bd116a6a4fc0a8ca755bd644c2c41c5ebe':
        raise ValueError('uv hash mismatch')
    framing = json.loads((ROOT/'web/public/avatar/live-framing.json').read_text(encoding='utf-8'))
    inputs = {
        'dimensions': [framing['width'], framing['height']], 'portrait_crop': framing['crop'],
        'portrait': {'digest': sha(files['inputs/portrait.png'])},
        'speech': {'digest': sha(files['inputs/speech-vi.wav'])},
        'note': 'Existing user portrait and previously recorded test WAV; no new paid TTS call.',
    }
    output = ROOT/'artifacts/avatar-flashhead-research.zip'
    output.parent.mkdir(exist_ok=True, parents=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, path in files.items():
            archive.write(path, name)
        archive.writestr('inputs/manifest.json', json.dumps(inputs, indent=2)+'\n')
    with zipfile.ZipFile(output) as archive:
        assert set(archive.namelist()) == set(files) | {'inputs/manifest.json'}
        assert archive.testzip() is None
    output.with_suffix('.zip.sha256').write_text(f'{sha(output)}  {output.name}\n', encoding='ascii')
    # Small update for the already-benchmarked GPU installation: preserve all
    # weights, private runtime and token; do not make the user download them again.
    update = ROOT/'artifacts/avatar-flashhead-live-update.zip'
    update_names = ['engine.py', 'service.py', 'serve.ps1', 'requirements-live.txt',
                    'avatar_wire.py', 'LIVE.md']
    with zipfile.ZipFile(update, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in update_names:
            archive.write(files[name], name)
    update.with_suffix('.zip.sha256').write_text(f'{sha(update)}  {update.name}\n', encoding='ascii')
    print(f'{output}\nModel download: {sum(x["size"] for x in manifest["files"])/1024**3:.2f} GiB'
          f'\nBundle: {output.stat().st_size/1024**2:.2f} MiB\nSHA256: {sha(output)}')


if __name__ == '__main__':
    main()
