import io
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from voice_agent.api import create_app
from voice_agent.config import Settings
from voice_agent.ocr import (
    MAX_UPLOAD_BYTES,
    OcrError,
    OcrResult,
    extract_document,
    validate_document,
)


def png():
    output = io.BytesIO()
    Image.new("RGB", (100, 50), "white").save(output, format="PNG")
    return output.getvalue()


def test_ocr_schema_avoids_unsupported_additional_properties():
    schema = OcrResult.model_json_schema()
    assert "additionalProperties" not in str(schema)


def test_document_validation_checks_bytes_not_only_extension_or_mime():
    validate_document(png(), "image/png")
    validate_document(b"%PDF-1.4\n", "application/pdf")
    for data, mime, status in [
        (b"", "image/png", 400), (b"hello", "application/pdf", 400),
        (png(), "image/jpeg", 400), (b"bad png", "image/png", 400),
        (b"hello", "image/svg+xml", 415), (b"a" * (MAX_UPLOAD_BYTES + 1), "image/png", 413),
    ]:
        with pytest.raises(OcrError) as caught:
            validate_document(data, mime)
        assert caught.value.status == status


@pytest.mark.asyncio
async def test_ocr_sends_inline_document_and_validates_structured_fields():
    response = MagicMock()
    response.text = '{"text":"Nguyễn An 0901234567","fields":{"full_name":"Nguyễn An","phone":"090 123 4567"},"warnings":[]}'
    api = MagicMock()
    api.models.generate_content = AsyncMock(return_value=response)
    client = MagicMock()
    client.aio.__aenter__.return_value = api
    settings = Settings(_env_file=None, gemini_api_key="private-test-key")
    with patch("voice_agent.ocr.genai.Client", return_value=client):
        result = await extract_document(settings, png(), "image/png")
    assert result["fields"]["phone"] == "0901234567"
    assert result["fields"]["address"] == ""
    assert "private-test-key" not in str(result)
    kwargs = api.models.generate_content.call_args.kwargs
    assert kwargs["contents"][0].inline_data.mime_type == "image/png"
    assert kwargs["config"].response_mime_type == "application/json"
    assert not kwargs["config"].tools


@pytest.mark.asyncio
async def test_birth_ocr_keeps_roles_separate_and_clears_only_invalid_values():
    response = MagicMock()
    response.text = '{"text":"Mẹ: Nguyễn An; trẻ: Trần Minh An", "fields":{"mother_name":"Nguyễn An","child_name":"Trần Minh An","child_birth_date":"31/02/2025","child_sex":"bé trai"},"warnings":[]}'
    api = MagicMock()
    api.models.generate_content = AsyncMock(return_value=response)
    client = MagicMock()
    client.aio.__aenter__.return_value = api
    with patch("voice_agent.ocr.genai.Client", return_value=client):
        result = await extract_document(Settings(_env_file=None, gemini_api_key="test"), png(), "image/png")
    assert result["fields"]["mother_name"] == "Nguyễn An"
    assert result["fields"]["child_name"] == "Trần Minh An"
    assert result["fields"]["full_name"] == ""
    assert result["fields"]["child_birth_date"] == ""
    assert result["fields"]["child_sex"] == "Nam"
    assert result["warnings"]


@pytest.mark.asyncio
async def test_provider_failure_is_sanitized_and_missing_key_is_explicit(caplog):
    with pytest.raises(OcrError) as caught:
        await extract_document(Settings(_env_file=None), png(), "image/png")
    assert caught.value.status == 503
    with patch("voice_agent.ocr.genai.Client", side_effect=RuntimeError("secret-key-in-url")):
        with pytest.raises(OcrError) as caught:
            await extract_document(Settings(_env_file=None, gemini_api_key="private"), png(), "image/png")
    assert caught.value.status == 502
    assert "secret-key-in-url" not in caught.value.message + caplog.text


def test_upload_endpoint_auth_size_rate_limit_and_no_disk_storage():
    app = create_app(Settings(_env_file=None, app_env="test", gemini_api_key="private",
                              app_access_token="access"))
    client = TestClient(app)
    headers = {"Authorization": "Bearer access", "Content-Type": "image/png"}
    assert client.post("/api/documents/ocr", content=png()).status_code == 401
    hostile = headers | {"Origin": "https://untrusted.example"}
    assert client.post("/api/documents/ocr", content=png(), headers=hostile).status_code == 403
    assert client.post("/api/documents/ocr", content=b"x" * (MAX_UPLOAD_BYTES + 1), headers=headers).status_code == 413
    result = {"text": "An", "fields": {"full_name": "An"}, "warnings": []}
    with patch("voice_agent.api.extract_document", new=AsyncMock(return_value=result)) as extract:
        response = client.post("/api/documents/ocr", content=png(), headers=headers)
        assert response.status_code == 200 and response.json() == result
        assert response.headers["Cache-Control"] == "no-store"
        assert extract.await_args.args[1] == png()
        for _ in range(4):
            assert client.post("/api/documents/ocr", content=png(), headers=headers).status_code == 200
        assert client.post("/api/documents/ocr", content=png(), headers=headers).status_code == 429
