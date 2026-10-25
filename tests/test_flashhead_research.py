"""Check real streaming boundaries and package integrity without a CUDA claim."""
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / 'deploy/avatar-flashhead'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, KIT / filename)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


stream = module('flashhead_test_stream', 'streaming.py')
assets = module('flashhead_test_assets', 'assets.py')


def test_fragmented_pcm_is_lossless_and_only_tail_is_padded():
    pcm = bytes(range(256))*121
    chunker = stream.PcmChunker()
    chunks = []
    for i in range(0, len(pcm), 641):
        chunks.extend(chunker.push(pcm[i:i+641]))
    chunks.extend(chunker.finish())
    assert b''.join(c.pcm[:c.valid_samples*2] for c in chunks) == pcm
    assert [c.sample_offset for c in chunks] == [0, 15360]
    assert len(chunks[-1].pcm) == 30720
    assert chunker.finish() == []


def test_interrupt_discards_buffer_and_changes_epoch():
    chunker = stream.PcmChunker(4)
    chunker.push(b'old')
    chunker.reset()
    chunks = chunker.push(b'new12345')
    assert chunks[0].epoch == 1
    assert chunks[0].sample_offset == 0
    assert chunks[0].pcm == b'new12345'


def test_malformed_tail_and_reuse_after_eof_rejected():
    chunker = stream.PcmChunker()
    chunker.push(b'x')
    with pytest.raises(ValueError, match='Incomplete'):
        chunker.finish()
    chunker.push(b'y')
    chunker.finish()
    with pytest.raises(ValueError, match='reset'):
        chunker.push(b'zz')


def test_high_average_fps_can_still_have_stalls():
    costs = [0.1, 0.1, 1.8, 0.1]
    assert sum(costs)/(4*0.96) < 1
    report = stream.playout_estimate(costs, 0.96)
    assert report['stall_events'] > 0
    assert report['buffer_needed_for_this_sample_s'] > 0.5


def test_input_timing_is_not_inference_time():
    live = stream.playout_estimate([0.2]*5, 0.96)
    ready = stream.playout_estimate([0.2]*5, 0.96, input_realtime=False)
    assert live['first_paired_av_ready_s'] == pytest.approx(1.16)
    assert ready['first_paired_av_ready_s'] == pytest.approx(0.2)
    assert live['stall_events'] == 0


@pytest.mark.parametrize('costs', [[], [float('nan')], [float('inf')], [-1]])
def test_invalid_timing_rejected(costs):
    with pytest.raises(ValueError):
        stream.playout_estimate(costs, 0.96)


def test_archive_traversal_rejected_before_any_write(tmp_path):
    source = tmp_path / 'bad.zip'
    with zipfile.ZipFile(source, 'w') as archive:
        archive.writestr('Root/good.txt', 'good')
        archive.writestr('Root/../../escape', 'bad')
    destination = tmp_path / 'source'
    with pytest.raises(ValueError):
        assets.extract(source, destination, 'Root/')
    assert not destination.exists()


def test_hash_verification_rejects_modified_asset(tmp_path):
    path = tmp_path/'weights'
    path.write_bytes(b'original')
    info = {'digest': assets.digest(path), 'size': path.stat().st_size}
    assets.verify(path, info)
    path.write_bytes(b'modified')
    with pytest.raises(ValueError, match='Checksum'):
        assets.verify(path, info)


def test_bundle_has_no_credentials_and_preserves_upstream_license(tmp_path):
    bundle = ROOT/'artifacts/avatar-flashhead-research.zip'
    if not bundle.exists():
        pytest.skip('Build the optional artifact first')
    with zipfile.ZipFile(bundle) as archive:
        names = archive.namelist()
        assert all('.env' not in n and '.runtime' not in n for n in names)
        for name in ['smoke.py', 'setup.ps1', 'benchmark.py', 'engine.py', 'streaming.py',
                     'assets.py', 'requirements.txt']:
            assert archive.read(name) == (KIT/name).read_bytes(), f'Stale bundle file: {name}'
        for name in names:
            destination = assets.child(tmp_path, name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(name))
    manifest = json.loads((tmp_path/'manifest.json').read_text())
    upstream = assets.prepare_source(tmp_path, manifest)
    assert 'Apache License' in (upstream/'LICENSE').read_text()
    assert len(manifest['files']) == 9
    assets.patch_single_gpu(upstream)  # idempotent
    source = (upstream/'flash_head/src/modules/flash_head_model.py').read_text(encoding='utf-8')
    compile(source, '<patched source>', 'exec')
    assert 'voice-agent: single-GPU Windows compatibility' in source


def test_live_update_preserves_runtime_and_contains_current_protocol():
    bundle = ROOT/'artifacts/avatar-flashhead-live-update.zip'
    if not bundle.exists():
        pytest.skip('Build the optional artifact first')
    expected = {'engine.py', 'service.py', 'serve.ps1', 'requirements-live.txt',
                'avatar_wire.py', 'LIVE.md'}
    with zipfile.ZipFile(bundle) as archive:
        assert set(archive.namelist()) == expected
        for name in expected:
            path = ROOT/'voice_agent/avatar_wire.py' if name == 'avatar_wire.py' else KIT/name
            assert archive.read(name) == path.read_bytes()
