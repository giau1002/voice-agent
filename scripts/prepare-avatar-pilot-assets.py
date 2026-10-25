"""Prepare a pinned source/model manifest; large checkpoints download on server."""
import hashlib
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'deploy/avatar-gpu'
REVISION = '0a89dec45a0192b824e3cf4daf96c239440c5ed8'
MODELS = {
    'TMElyralab/MuseTalk': {
        'musetalkV15/musetalk.json': 'musetalkV15/musetalk.json',
        'musetalkV15/unet.pth': 'musetalkV15/unet.pth',
    },
    'stabilityai/sd-vae-ft-mse': {
        'config.json': 'sd-vae/config.json',
        'diffusion_pytorch_model.bin': 'sd-vae/diffusion_pytorch_model.bin',
    },
    'openai/whisper-tiny': {
        'config.json': 'whisper/config.json',
        'preprocessor_config.json': 'whisper/preprocessor_config.json',
        'pytorch_model.bin': 'whisper/pytorch_model.bin',
    },
    'ManyOtherFunctions/face-parse-bisent': {
        '79999_iter.pth': 'face-parse-bisent/79999_iter.pth',
        'resnet18-5c106cde.pth': 'face-parse-bisent/resnet18-5c106cde.pth',
    },
}


def main():
    url = f'https://codeload.github.com/TMElyralab/MuseTalk/zip/{REVISION}'
    source = urllib.request.urlopen(url, timeout=120).read()
    cache = ROOT / '.tools/avatar-pilot'
    cache.mkdir(exist_ok=True, parents=True)
    (cache / 'musetalk-source.zip').write_bytes(source)
    manifest = {'source': {'url': url, 'revision': REVISION,
                          'sha256': hashlib.sha256(source).hexdigest()}, 'files': []}
    for repo, names in MODELS.items():
        with urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}?blobs=true', timeout=60) as stream:
            info = json.load(stream)
        for remote, local in names.items():
            item = next(file for file in info['siblings'] if file['rfilename'] == remote)
            lfs = item.get('lfs')
            manifest['files'].append({
                'repo': repo, 'revision': info['sha'], 'remote': remote, 'path': local,
                'size': item['size'], 'algorithm': 'sha256' if lfs else 'git-sha1',
                'digest': lfs['sha256'] if lfs else item['blobId'],
            })
    (OUT / 'models-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('Pinned source and', len(manifest['files']), 'model files;',
          round(sum(file['size'] for file in manifest['files']) / 1024**3, 2), 'GiB')


if __name__ == '__main__':
    main()
