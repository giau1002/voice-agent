"""Same-origin API, scoped LiveKit tokens and optional built web hosting."""
import asyncio
import hashlib
import hmac
import ipaddress
import logging
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from livekit import api
from pydantic import BaseModel, Field

from .config import ROOT, Settings, get_settings

logger = logging.getLogger(__name__)


class SessionRequest(BaseModel):
    display_name: str = Field(default="Khách", min_length=1, max_length=60)


def make_token(settings: Settings, room: str, identity: str, display_name: str) -> str:
    return (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret.get_secret_value())
        .with_identity(identity)
        .with_name(display_name)
        .with_ttl(timedelta(minutes=10))
        .with_grants(api.VideoGrants(
            room_join=True, room=room, can_publish=True, can_subscribe=True,
            can_publish_data=True, can_publish_sources=["microphone"],
            can_update_own_metadata=False,
        ))
        .with_room_config(api.RoomConfiguration(
            name=room, max_participants=2, empty_timeout=60, departure_timeout=30,
            agents=[api.RoomAgentDispatch(agent_name=settings.livekit_agent_name)],
        ))
        .to_jwt()
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # A single process holds rate counters; use an ingress limiter for many replicas.
        yield

    app = FastAPI(title="Portrait Voice Agent", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.rate_buckets = defaultdict(deque)
    app.state.issued_sessions = {}
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Session-Key"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(self)"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    async def authorize(request: Request, authorization: str = Header(default="")):
        origin = request.headers.get("origin")
        if origin and origin not in settings.origins:
            raise HTTPException(403, "Origin không được phép")
        expected = settings.app_access_token.get_secret_value()
        supplied = authorization.removeprefix("Bearer ")
        if expected:
            if not hmac.compare_digest(supplied, expected):
                raise HTTPException(401, "Nhập mã truy cập trong phần Cài đặt")
        else:
            host = request.client.host if request.client else ""
            try:
                local = ipaddress.ip_address(host).is_loopback
            except ValueError:
                local = host in {"testclient", "localhost"} and settings.app_env == "test"
            if not local:
                raise HTTPException(403, "Cấu hình APP_ACCESS_TOKEN để truy cập từ thiết bị khác")

    @app.get("/api/health")
    async def health():
        return {"ok": True, "service": "portrait-voice-agent", "version": "0.1.0"}

    @app.get("/api/config")
    async def config():
        return {
            "auth_required": bool(settings.app_access_token.get_secret_value()),
            "providers": {"transport": "LiveKit", "stt": "Soniox", "tts": "Soniox",
                          "llm": settings.llm_provider, "vad": "Silero"},
            "configured": not settings.missing_configuration,
            "missing": settings.missing_configuration,
            "language": settings.soniox_tts_language,
            "session_max_seconds": settings.session_max_seconds,
            "lip_sync": "audio + synchronized text; phonemes estimated",
            "timezone": settings.agent_timezone,
            "web_search": settings.can_search_web,
        }

    @app.post("/api/sessions", dependencies=[Depends(authorize)])
    async def create_session(body: SessionRequest, request: Request):
        if settings.missing_configuration:
            raise HTTPException(503, {"code": "configuration_missing",
                                     "missing": settings.missing_configuration})
        now = time.monotonic()
        # Remove expired records and inactive rate buckets without storing conversation data.
        app.state.issued_sessions = {key: value for key, value in app.state.issued_sessions.items()
                                     if value[0] > now}
        for key in list(app.state.rate_buckets):
            bucket = app.state.rate_buckets[key]
            while bucket and now - bucket[0] > 60:
                bucket.popleft()
            if not bucket:
                del app.state.rate_buckets[key]
        key = request.client.host if request.client else "unknown"
        bucket = app.state.rate_buckets[key]
        if len(bucket) >= 6:
            raise HTTPException(429, "Tạo phiên quá nhanh, vui lòng chờ một phút")
        bucket.append(now)
        session_id = secrets.token_hex(16)
        room = f"portrait-{session_id}"
        identity = f"user-{secrets.token_hex(8)}"
        session_key = secrets.token_urlsafe(32)
        app.state.issued_sessions[session_id] = (
            now + settings.session_max_seconds + 600,
            hashlib.sha256(session_key.encode()).digest(), room,
        )
        return {
            "session_id": session_id, "session_key": session_key,
            "url": settings.livekit_url, "room": room, "identity": identity,
            "token": make_token(settings, room, identity, body.display_name),
            "max_seconds": settings.session_max_seconds,
        }

    @app.delete("/api/sessions/{session_id}", dependencies=[Depends(authorize)])
    async def end_session(session_id: str, x_session_key: str = Header(default="")):
        record = app.state.issued_sessions.get(session_id)
        if record is None:
            return Response(status_code=204)
        if not hmac.compare_digest(hashlib.sha256(x_session_key.encode()).digest(), record[1]):
            raise HTTPException(403, "Mã phiên không hợp lệ")
        try:
            async with api.LiveKitAPI(
                url=settings.internal_livekit_url, api_key=settings.livekit_api_key,
                api_secret=settings.livekit_api_secret.get_secret_value(),
            ) as client:
                await asyncio.wait_for(
                    client.room.delete_room(api.DeleteRoomRequest(room=record[2])), timeout=5
                )
        except Exception:
            # Explicit failure permits a retry. Do not reveal upstream credentials or URL details.
            logger.warning("Room cleanup failed for session %s", session_id)
            raise HTTPException(502, "Chưa đóng được phòng; phiên sẽ tự hết hạn") from None
        del app.state.issued_sessions[session_id]
        return Response(status_code=204)

    dist = ROOT / "web" / "dist"
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="web")
    else:
        @app.get("/")
        async def no_build():
            return {"message": "Run npm run dev in web/ or build the frontend first",
                    "health": "/api/health"}
    return app


app = create_app()
