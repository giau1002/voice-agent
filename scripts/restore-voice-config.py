"""Restore the voice settings used before the web-search optimization."""
from pathlib import Path

from dotenv import set_key


def restore_voice_settings(path: Path):
    if not path.is_file():
        raise FileNotFoundError("Create .env from .env.example and fill provider keys first")
    set_key(path, "SONIOX_STT_MODEL", "stt-rt-v4", quote_mode="never")
    set_key(path, "SONIOX_MAX_ENDPOINT_DELAY_MS", "1000", quote_mode="never")


if __name__ == "__main__":
    restore_voice_settings(Path(__file__).resolve().parents[1] / ".env")
    print("Restored voice settings: stt-rt-v4, endpoint delay 1000 ms. Restart the worker.")
