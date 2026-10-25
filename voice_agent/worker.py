"""LiveKit room worker. Run: python -m voice_agent.worker dev|start."""
import asyncio
import json
import logging
import sys
import time
from dataclasses import asdict

from livekit import agents, rtc
from livekit.agents import AgentSession, JobContext, room_io

from .assistant import PortraitAgent
from .config import get_settings
from .forms import DemoForm, FormCommand
from .greeting import load_greeting, prepare_greeting
from .providers import build_llm, build_stt, build_tts, build_vad
from .web_search import SearchResult

logger = logging.getLogger("portrait-voice")
settings = get_settings()
server = agents.AgentServer(
    num_idle_processes=1, ws_url=settings.internal_livekit_url, api_key=settings.livekit_api_key,
    api_secret=settings.livekit_api_secret.get_secret_value(),
)


@server.rtc_session(agent_name=settings.livekit_agent_name)
async def entrypoint(ctx: JobContext):
    started = time.perf_counter()
    if settings.missing_configuration:
        logger.error("Missing configuration: %s", ", ".join(settings.missing_configuration))
        ctx.shutdown(reason="configuration_missing")
        return

    await ctx.connect()
    try:
        participant = await asyncio.wait_for(ctx.wait_for_participant(), timeout=30)
    except TimeoutError:
        ctx.shutdown(reason="participant_timeout")
        return
    except RuntimeError:
        if not ctx.room.isconnected():
            logger.info("Room closed before participant finished connecting")
            ctx.shutdown(reason="participant_disconnected_during_connect")
            return
        raise
    speech = build_tts(settings)
    speech.prewarm()  # Open Soniox while GPU tracks and the VAD are prepared.
    session = AgentSession(
        stt=build_stt(settings), llm=build_llm(settings), tts=speech,
        vad=await asyncio.to_thread(build_vad),
        turn_handling={
            "turn_detection": "stt",
            "interruption": {"enabled": True, "min_duration": 0.45},
        },
        # Soniox does not expose phoneme timing in this adapter. Let LiveKit
        # synchronize text with playout, and gate avatar motion from client audio.
        use_tts_aligned_transcript=False,
    )
    tasks: set[asyncio.Task] = set()

    async def publish_form(snapshot: dict):
        await ctx.room.local_participant.send_text(
            json.dumps(snapshot, ensure_ascii=False), topic="portrait.form",
        )

    form = DemoForm(publish_form)
    session_ready = False

    @ctx.room.local_participant.register_rpc_method("portrait.form")
    async def control_form(data: rtc.RpcInvocationData):
        if data.caller_identity != participant.identity:
            raise rtc.RpcError(1500, "Unauthorized participant")
        if not session_ready:
            raise rtc.RpcError(1501, "Trợ lý đang khởi tạo. Anh/chị chờ ít giây rồi thử lại nhé.")
        try:
            command = FormCommand.model_validate_json(data.payload)
        except ValueError:
            raise rtc.RpcError(1501, "Thông tin form chưa hợp lệ.") from None
        await session.interrupt()
        try:
            snapshot = await form.command(command)
        except ValueError as error:
            raise rtc.RpcError(1501, str(error)) from None
        if command.action == "start":
            session.generate_reply(instructions=(
                "Người dùng vừa bật hỏi đáp điền form. Dựa trên trạng thái form hiện tại, "
                "xác nhận ngắn thông tin đã có rồi hỏi đúng một mục còn thiếu đầu tiên. "
                "Nếu đã đủ, mời kiểm tra và xác nhận tờ khai."
            ))
        return json.dumps(snapshot, ensure_ascii=False)

    async def publish(message: dict):
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps(message, ensure_ascii=False).encode(), reliable=True, topic="portrait"
            )
        except Exception:
            logger.debug("Room closed before event delivery")

    def send(kind: str, payload: dict):
        task = asyncio.create_task(publish({"type": kind, "payload": payload}))
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    @session.on("agent_state_changed")
    def on_agent_state(event):
        send("agent.state", {"state": event.new_state})

    @session.on("user_state_changed")
    def on_user_state(event):
        send("user.state", {"state": event.new_state})

    @session.on("error")
    def on_error(event):
        # Never forward raw provider exceptions (they can contain request URLs/keys).
        logger.error("Voice provider error from %s", type(event.source).__name__)
        send("agent.error", {"code": "provider_error",
                             "message": "Dịch vụ giọng nói hoặc LLM gặp lỗi. Hãy thử lại."})

    async def on_text(sess: AgentSession, event: room_io.TextInputEvent):
        text = event.text.strip()
        if not text or len(text) > 2000:
            send("agent.error", {"code": "invalid_text", "message": "Nhập từ 1 đến 2.000 ký tự."})
            return
        await sess.interrupt()
        sess.generate_reply(user_input=text)

    @ctx.room.local_participant.register_rpc_method("portrait.interrupt")
    async def interrupt(data: rtc.RpcInvocationData):
        if data.caller_identity != participant.identity:
            raise rtc.RpcError(1500, "Unauthorized participant")
        await session.interrupt()
        return "ok"

    async def expire():
        await asyncio.sleep(settings.session_max_seconds)
        send("session.expired", {"message": "Phiên đã hết thời gian. Bạn có thể mở phiên mới."})
        await session.aclose()
        ctx.shutdown(reason="session_time_limit")

    timeout_task = asyncio.create_task(expire())
    avatar_output = None

    async def cleanup():
        timeout_task.cancel()
        for task in tuple(tasks):
            task.cancel()
        await session.aclose()
        if avatar_output:
            await avatar_output.aclose()

    ctx.add_shutdown_callback(cleanup)

    if settings.avatar_mode == "flashhead":
        from .avatar import FlashHeadOutput

        def avatar_failed():
            async def notify_and_shutdown():
                await publish({"type": "agent.error", "payload": {
                    "code": "avatar_unavailable", "message":
                    "Kết nối với nhân vật bị gián đoạn. Anh/chị kết nối lại giúp em nhé."}})
                ctx.shutdown(reason="avatar_renderer_failed")
            task = asyncio.create_task(notify_and_shutdown())
            tasks.add(task)
            task.add_done_callback(tasks.discard)

        try:
            avatar_output = await FlashHeadOutput.connect(
                ctx.room, settings.avatar_renderer_url,
                settings.avatar_renderer_token.get_secret_value(), avatar_failed,
                wait_for_speech=bool(settings.agent_greeting.strip()),
            )
            session.output.audio = avatar_output
        except Exception as error:
            logger.warning("Avatar startup failed (%s)", type(error).__name__)
            await publish({"type": "agent.error", "payload": {"message":
                "Chưa kết nối được nhân vật. Server GPU có thể đang bận hoặc chưa được bật."}})
            ctx.shutdown(reason="avatar_renderer_unavailable")
            return

    async def publish_search(result: SearchResult):
        # Text streams handle the provider's HTML/source payload without the small
        # data-packet limit. Only this room's agent can produce frontend references.
        await ctx.room.local_participant.send_text(
            json.dumps(asdict(result), ensure_ascii=False), topic="portrait.sources",
        )

    await session.start(
        agent=PortraitAgent(settings, publish_search, greeting=load_greeting(settings), form=form),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            participant_identity=participant.identity,
            text_input=room_io.TextInputOptions(text_input_cb=on_text),
            audio_input=True, video_input=False,
            audio_output=avatar_output is None,
            text_output=room_io.TextOutputOptions(sync_transcription=True),
            close_on_disconnect=True,
        ),
    )
    session_ready = True
    logger.info('Voice session ready', extra={'voice_session_setup_ms': round((time.perf_counter()-started)*1000)})


if __name__ == "__main__":
    # Public, fixed greeting only. Do this before accepting jobs, so each click
    # avoids a fresh TTS request. A failure keeps ordinary live TTS available.
    if len(sys.argv) > 1 and sys.argv[1] in {'start', 'dev'} and not settings.missing_configuration:
        try:
            asyncio.run(asyncio.wait_for(prepare_greeting(settings), timeout=15))
        except Exception as error:
            logger.warning('Greeting prewarm unavailable (%s); using live TTS', type(error).__name__)
    agents.cli.run_app(server)
