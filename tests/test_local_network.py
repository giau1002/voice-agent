from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent


def test_native_local_rtc_does_not_map_lan_socket_to_loopback():
    config = yaml.safe_load((ROOT / "deploy/livekit.local.yaml").read_text())
    assert config["rtc"].get("node_ip") != "127.0.0.1"
    assert not config["rtc"].get("use_external_ip")
    launcher = (ROOT / "scripts/start.ps1").read_text()
    assert "'--node-ip','127.0.0.1'" not in launcher


@pytest.mark.asyncio
async def test_worker_exits_cleanly_if_client_leaves_during_connect():
    from voice_agent import worker

    ctx = MagicMock()
    ctx.connect = AsyncMock()
    ctx.wait_for_participant = AsyncMock(side_effect=RuntimeError("room disconnected"))
    ctx.room.isconnected.return_value = False
    with patch.object(worker, "settings") as settings:
        settings.missing_configuration = []
        await worker.entrypoint(ctx)
    ctx.shutdown.assert_called_once_with(reason="participant_disconnected_during_connect")
