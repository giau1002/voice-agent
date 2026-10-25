"""Build an explicit allowlist bundle for the server. No .env or provider keys."""
import hashlib
import json
import wave
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'deploy/avatar-gpu'
CACHE = ROOT / '.tools/avatar-pilot'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    names = ['setup-model.ps1', 'resolve-runtime.ps1', 'run-pilot.ps1', 'fetch_models.py', 'requirements-pilot.txt',
             'constraints-pilot.txt', 'models-manifest.json', 'check_cuda.py',
             'run_pilot.py', 'PILOT.md']
    files = {name: BUNDLE / name for name in names}
    files.update({'musetalk-source.zip': CACHE / 'musetalk-source.zip',
                  'inputs/portrait.png': ROOT / 'web/public/avatar/portrait.png',
                  'inputs/speech-vi.wav': CACHE / 'speech-vi.wav',
                  'inputs/speech-vi.json': CACHE / 'speech-vi.json'})
    source_manifest = json.loads((BUNDLE / 'models-manifest.json').read_text())
    assert digest(files['musetalk-source.zip']) == source_manifest['source']['sha256']
    with wave.open(str(files['inputs/speech-vi.wav'])) as wav:
        assert wav.getnchannels() == 1 and 2 < wav.getnframes()/wav.getframerate() < 25
    inputs = {'dimensions': [560, 700], 'face_box': [204, 91, 355, 248],
              'portrait': {'sha256': digest(files['inputs/portrait.png'])},
              'speech': {'sha256': digest(files['inputs/speech-vi.wav'])},
              'identity': 'Existing project portrait supplied by user; no reference-video face.',
              'source_motion': 'static portrait; lip-sync-only evaluation'}
    output = ROOT / 'artifacts/avatar-musetalk-pilot.zip'
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, path in files.items():
            archive.write(path, name)
        archive.writestr('inputs/manifest.json', json.dumps(inputs, indent=2) + '\n')
    with zipfile.ZipFile(output) as archive:
        assert set(archive.namelist()) == set(files) | {'inputs/manifest.json'}
        assert archive.testzip() is None
    sha = digest(output)
    output.with_suffix('.zip.sha256').write_text(f'{sha}  {output.name}\n', encoding='ascii')
    print(f'{output}\n{output.stat().st_size} bytes\nSHA256 {sha}')
    patch = ROOT / 'artifacts/avatar-musetalk-runtime-fix.zip'
    patch_names = ['setup-model.ps1', 'resolve-runtime.ps1', 'run-pilot.ps1', 'PILOT.md']
    with zipfile.ZipFile(patch, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name in patch_names:
            archive.write(BUNDLE / name, name)
    with zipfile.ZipFile(patch) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == set(patch_names)
    patch_sha = digest(patch)
    patch.with_suffix('.zip.sha256').write_text(f'{patch_sha}  {patch.name}\n', encoding='ascii')
    print(f'Runtime patch: {patch}\n{patch.stat().st_size} bytes\nSHA256 {patch_sha}')


if __name__ == '__main__':
    main()
