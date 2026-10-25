"""Model download integrity and bounded portrait geometry, without CUDA calls."""
import hashlib
import importlib.util
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

BUNDLE = Path(__file__).resolve().parents[1] / 'deploy/avatar-gpu'


def load(name):
    spec = importlib.util.spec_from_file_location(name, BUNDLE / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fetch = load('fetch_models')
sys.modules['fetch_models'] = fetch
pilot = load('run_pilot')


def test_corrupt_model_is_rejected(tmp_path):
    path = tmp_path / 'model.bin'
    path.write_bytes(b'model')
    info = {'size': 5, 'digest': hashlib.sha256(b'model').hexdigest(), 'algorithm': 'sha256'}
    fetch.verify(path, info)
    path.write_bytes(b'other')
    with pytest.raises(ValueError, match='Checksum mismatch'):
        fetch.verify(path, info)


def test_hf_git_blob_digest(tmp_path):
    path = tmp_path / 'config.json'
    path.write_bytes(b'hello\n')
    assert fetch.file_digest(path, 'git-sha1') == 'ce013625030ba8dba906f756967f9e9ca394464a'


def test_source_traversal_rejected_before_any_write(tmp_path):
    archive = tmp_path / 'source.zip'
    with zipfile.ZipFile(archive, 'w') as file:
        file.writestr('MuseTalk-abc/safe.py', 'ok')
        file.writestr('MuseTalk-abc/../outside.py', 'bad')
    destination = tmp_path / 'source'
    with pytest.raises(ValueError, match='outside'):
        fetch.unpack_source(archive, destination, 'abc')
    assert not destination.exists()
    assert not (tmp_path / 'outside.py').exists()


def test_valid_source_preserves_paths_and_license(tmp_path):
    archive = tmp_path / 'source.zip'
    with zipfile.ZipFile(archive, 'w') as file:
        file.writestr('MuseTalk-abc/LICENSE', 'license')
        file.writestr('MuseTalk-abc/musetalk/models/test.py', 'module')
    fetch.unpack_source(archive, tmp_path / 'source', 'abc')
    assert (tmp_path / 'source/LICENSE').read_text() == 'license'
    assert (tmp_path / 'source/musetalk/models/test.py').read_text() == 'module'


@pytest.mark.parametrize('box', [[-1, 91, 355, 248], [204, 91, 999, 248], [204, 248, 355, 91], [204, 91, 205, 248]])
def test_invalid_crop_cannot_reach_model(box):
    with pytest.raises(ValueError):
        pilot.validate_box(box, 560, 700)


def test_preview_escapes_error_or_metadata_content(tmp_path):
    pilot.write_preview(tmp_path, {'note': '<script>unsafe</script>'})
    page = (tmp_path / 'index.html').read_text(encoding='utf-8')
    assert '<script>' not in page
    assert '&lt;script&gt;' in page


def fake_cuda_runtime(parent):
    runtime = parent / '.runtime'
    for relative in ['uv/uv.exe', 'musetalk-venv/Scripts/python.exe']:
        path = runtime / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
    return runtime


def resolve_runtime(bundle, explicit=None):
    if os.name != 'nt':
        pytest.skip('Windows PowerShell runtime discovery')
    def quote(value):
        return "'" + str(value).replace("'", "''") + "'"
    command = ("$ErrorActionPreference='Stop'; . " + quote(BUNDLE / 'resolve-runtime.ps1')
               + '; Resolve-AvatarCudaRuntime -BundleRoot ' + quote(bundle))
    if explicit:
        command += ' -RuntimePath ' + quote(explicit)
    return subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
                          capture_output=True, text=True, check=False)


def test_runtime_found_in_sibling_folder_with_spaces(tmp_path):
    bundle = tmp_path / 'musetalk pilot'
    bundle.mkdir()
    runtime = fake_cuda_runtime(tmp_path / 'cuda check')
    result = resolve_runtime(bundle)
    assert result.returncode == 0, result.stderr
    assert Path(result.stdout.strip()) == runtime


def test_explicit_runtime_accepts_check_folder_or_runtime(tmp_path):
    bundle = tmp_path / 'pilot'
    bundle.mkdir()
    runtime = fake_cuda_runtime(tmp_path / 'elsewhere' / 'cuda check')
    for explicit in [runtime.parent, runtime]:
        result = resolve_runtime(bundle, explicit)
        assert result.returncode == 0, result.stderr
        assert Path(result.stdout.strip()) == runtime


def test_ambiguous_runtime_is_not_guessed(tmp_path):
    bundle = tmp_path / 'pilot'
    bundle.mkdir()
    fake_cuda_runtime(tmp_path / 'cuda one')
    fake_cuda_runtime(tmp_path / 'cuda two')
    result = resolve_runtime(bundle)
    assert result.returncode != 0
    assert 'Multiple CUDA environments' in result.stderr
    assert not (bundle / '.runtime').exists()


def test_own_runtime_wins_over_unrelated_siblings(tmp_path):
    bundle = tmp_path / 'pilot'
    own = fake_cuda_runtime(bundle)
    fake_cuda_runtime(tmp_path / 'cuda one')
    fake_cuda_runtime(tmp_path / 'cuda two')
    result = resolve_runtime(bundle)
    assert result.returncode == 0, result.stderr
    assert Path(result.stdout.strip()) == own
