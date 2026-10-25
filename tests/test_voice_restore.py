import runpy
from io import StringIO
from pathlib import Path

from dotenv import dotenv_values


def test_restore_voice_settings_preserves_keys_and_search_configuration(tmp_path):
    path = tmp_path / ".env"
    original = (
        "# Keep server-specific settings\n"
        "SONIOX_API_KEY=private-example-key\n"
        "AVATAR_RENDERER_TOKEN=private-example-renderer-token\n"
        "SONIOX_STT_MODEL=stt-rt-v5\n"
        "SONIOX_MAX_ENDPOINT_DELAY_MS=700\n"
        "WEB_SEARCH_MODEL=gemini-3.1-flash-lite\n"
        "GEMINI_MODEL=existing-conversation-model\n"
    )
    path.write_text(original, encoding="utf-8")
    restore = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/restore-voice-config.py"))[
        "restore_voice_settings"
    ]
    restore(path)
    once = path.read_text(encoding="utf-8")
    restore(path)
    assert path.read_text(encoding="utf-8") == once
    expected = dict(dotenv_values(stream=StringIO(original)))
    expected.update(SONIOX_STT_MODEL="stt-rt-v4", SONIOX_MAX_ENDPOINT_DELAY_MS="1000")
    assert dict(dotenv_values(path)) == expected
    assert "# Keep server-specific settings" in once
