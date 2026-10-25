from unittest.mock import AsyncMock, patch

import jwt
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from voice_agent.api import create_app
from voice_agent.config import Settings


def settings(**kwargs):
    return Settings(_env_file=None, app_env="test", soniox_api_key="soniox-test",
                    gemini_api_key="gemini-test", **kwargs)


def test_config_never_exposes_provider_secrets():
    client = TestClient(create_app(settings()))
    result = client.get("/api/config")
    assert result.status_code == 200
    assert result.json()["configured"]
    assert "soniox-test" not in result.text
    assert "gemini-test" not in result.text
    assert "devsecret" not in result.text
    assert result.headers["Cache-Control"] == "no-store"


def test_avatar_configuration_exposes_mode_but_not_gpu_credentials():
    config = settings(avatar_mode='flashhead', avatar_renderer_url='http://gpu.internal:8890',
                      avatar_renderer_token='private-renderer-key-'*3)
    result = TestClient(create_app(config)).get('/api/config')
    assert result.json()['avatar_mode'] == 'flashhead'
    assert result.json()['configured']
    assert 'gpu.internal' not in result.text and 'private-renderer-key' not in result.text
    missing = settings(avatar_mode='flashhead').missing_configuration
    assert 'AVATAR_RENDERER_URL' in missing
    assert any('AVATAR_RENDERER_TOKEN' in name for name in missing)


def test_missing_config_blocks_token_creation():
    config = Settings(_env_file=None, app_env="test")
    client = TestClient(create_app(config))
    assert not client.get("/api/config").json()["configured"]
    result = client.post("/api/sessions", json={})
    assert result.status_code == 503
    assert "SONIOX_API_KEY" in result.json()["detail"]["missing"]


def test_scoped_tokens_unique_rooms_and_explicit_dispatch():
    client = TestClient(create_app(settings()))
    a = client.post("/api/sessions", json={"display_name": "Khách thử"}).json()
    b = client.post("/api/sessions", json={}).json()
    assert a["room"] != b["room"]
    claims = jwt.decode(a["token"], "devsecret", algorithms=["HS256"], issuer="devkey")
    assert claims["sub"] == a["identity"]
    assert claims["video"]["room"] == a["room"]
    assert claims["video"]["canPublishSources"] == ["microphone"]
    assert not claims["video"].get("roomAdmin")
    assert claims["exp"] - claims["nbf"] == 600
    assert claims["roomConfig"]["agents"][0]["agentName"] == "portrait-voice"
    assert claims["roomConfig"]["maxParticipants"] == 2


def test_authorization_and_origin_required():
    client = TestClient(create_app(settings(app_access_token="test-access")))
    assert client.post("/api/sessions", json={}).status_code == 401
    headers = {"Authorization": "Bearer test-access", "Origin": "https://untrusted.example"}
    assert client.post("/api/sessions", json={}, headers=headers).status_code == 403
    headers["Origin"] = "http://localhost:5173"
    assert client.post("/api/sessions", json={}, headers=headers).status_code == 200


def test_rate_limit_and_validation():
    client = TestClient(create_app(settings()))
    assert client.post("/api/sessions", json={"display_name": "a" * 61}).status_code == 422
    for _ in range(6):
        assert client.post("/api/sessions", json={}).status_code == 200
    assert client.post("/api/sessions", json={}).status_code == 429


def test_only_session_owner_can_end_room():
    client = TestClient(create_app(settings()))
    data = client.post("/api/sessions", json={}).json()
    url = "/api/sessions/" + data["session_id"]
    assert client.delete(url, headers={"X-Session-Key": "wrong"}).status_code == 403
    service = AsyncMock()
    service.__aenter__.return_value = service
    with patch("voice_agent.api.api.LiveKitAPI", return_value=service):
        result = client.delete(url, headers={"X-Session-Key": data["session_key"]})
    assert result.status_code == 204
    assert service.room.delete_room.call_args.args[0].room == data["room"]
    assert client.delete(url).status_code == 204


def test_cleanup_failure_can_be_retried_without_exposing_upstream_error():
    client = TestClient(create_app(settings()))
    data = client.post("/api/sessions", json={}).json()
    service = AsyncMock()
    service.__aenter__.return_value = service
    service.room.delete_room.side_effect = RuntimeError("secret-provider-key")
    with patch("voice_agent.api.api.LiveKitAPI", return_value=service):
        result = client.delete("/api/sessions/" + data["session_id"], headers={"X-Session-Key": data["session_key"]})
    assert result.status_code == 502
    assert "secret-provider-key" not in result.text
    assert data["session_id"] in client.app.state.issued_sessions


def test_production_rejects_insecure_defaults():
    with pytest.raises(ValidationError, match="APP_ACCESS_TOKEN"):
        Settings(_env_file=None, app_env="production")
    with pytest.raises(ValidationError, match="LiveKit credentials"):
        Settings(_env_file=None, app_env="production", app_access_token="a" * 32)


def test_local_llm_requires_explicit_endpoint():
    with pytest.raises(ValidationError, match="LLM_BASE_URL"):
        Settings(_env_file=None, llm_provider="local")
