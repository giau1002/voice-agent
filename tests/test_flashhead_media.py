"""Exercise real resampling and H264/AAC output without loading model weights."""
import importlib.util
import math
import subprocess
import wave
from pathlib import Path

import pytest

KIT = Path(__file__).resolve().parents[1] / 'deploy/avatar-flashhead'


@pytest.fixture
def media(monkeypatch):
    for dependency in ['numpy', 'scipy', 'PIL', 'imageio', 'imageio_ffmpeg']:
        pytest.importorskip(dependency)
    monkeypatch.syspath_prepend(str(KIT))
    spec = importlib.util.spec_from_file_location('flashhead_media', KIT/'benchmark.py')
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def test_stereo_24k_audio_keeps_duration_and_pitch(media, tmp_path):
    np = media.np
    rate = 24000
    duration = 1.25
    wave_data = np.sin(2*np.pi*440*np.arange(int(rate*duration))/rate)
    stereo = np.column_stack([wave_data*16000, wave_data*8000]).astype('<i2')
    source = tmp_path/'stereo.wav'
    with wave.open(str(source), 'wb') as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(stereo.tobytes())
    pcm = media.read_audio(source)
    assert len(pcm) == int(16000*duration)*2
    signal = np.frombuffer(pcm, dtype='<i2').astype(np.float32)
    peak = np.argmax(np.abs(np.fft.rfft(signal))) * 16000/len(signal)
    assert peak == pytest.approx(440, abs=1)
    assert np.sqrt(np.mean(signal**2)) == pytest.approx(12000/math.sqrt(2), rel=0.01)


@pytest.mark.parametrize('seconds', [1.0, 1.001, 6.495])
def test_recording_preserves_tail_frames_and_audio(media, tmp_path, seconds):
    import imageio.v2 as imageio
    import imageio_ffmpeg

    np = media.np
    count = int(seconds*16000)
    pcm = (np.sin(2*np.pi*440*np.arange(count)/16000)*12000).astype('<i2').tobytes()
    media.write_wav(tmp_path/'speech.wav', pcm)
    expected = math.ceil(count/16000*25)
    # Distinct grayscale frames expose lost/duplicated/reordered final frames.
    frames = np.stack([np.full((64, 64, 3), i, dtype=np.uint8) for i in range(expected)])
    assert media.write_review(tmp_path, [frames[:24], frames[24:]], expected, 25) == expected
    with imageio.get_reader(str(tmp_path/'review.mp4')) as reader:
        assert reader.get_meta_data()['fps'] == pytest.approx(25)
        for i, frame in enumerate(reader):
            assert frame.mean() == pytest.approx(i, abs=3)
    decoded = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', str(tmp_path/'review.mp4'),
         '-map', '0:a:0', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-'],
        check=True, capture_output=True,
    ).stdout
    # AAC has 1024-sample packets. It must not lose the tail or add a large delay.
    assert abs(len(decoded)//2 - count) <= 1024
    decoded_signal = np.frombuffer(decoded, dtype='<i2').astype(np.float32)
    assert np.corrcoef(decoded_signal[:min(count, len(decoded_signal))],
                      np.frombuffer(pcm, dtype='<i2')[:len(decoded_signal)])[0, 1] > 0.97
