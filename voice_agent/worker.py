"""LiveKit room worker. Run: python -m voice_agent.worker dev|start."""
import asyncio
import json
import logging

from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, JobContext, room_io

from .config import get_settings
from .providers import build_llm, build_stt, build_tts, build_vad

logger = logging.getLogger("portrait-voice")
settings = get_settings()
server = agents.AgentServer(
    num_idle_processes=1, ws_url=settings.internal_livekit_url, api_key=settings.livekit_api_key,
    api_secret=settings.livekit_api_secret.get_secret_value(),
)


class PortraitAgent(Agent):
    async def on_enter(self) -> None:
        if settings.agent_greeting:
            self.session.say(settings.agent_greeting, allow_interruptions=True)


@server.rtc_session(agent_name=settings.livekit_agent_name)
async def entrypoint(ctx: JobContext):
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
    session = AgentSession(
        stt=build_stt(settings), llm=build_llm(settings), tts=build_tts(settings),
        vad=build_vad(),
        turn_handling={
            "turn_detection": "stt",
            "interruption": {"enabled": True, "min_duration": 0.45},
        },
        # Soniox does not expose phoneme timing in this adapter. Let LiveKit
        # synchronize text with playout, and gate avatar motion from client audio.
        use_tts_aligned_transcript=False,
    )
    tasks: set[asyncio.Task] = set()

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

    async def cleanup():
        timeout_task.cancel()
        for task in tuple(tasks):
            task.cancel()
        await session.aclose()

    ctx.add_shutdown_callback(cleanup)
    await session.start(
        agent=PortraitAgent(instructions=settings.prompt()), room=ctx.room,
        room_options=room_io.RoomOptions(
            participant_identity=participant.identity,
            text_input=room_io.TextInputOptions(text_input_cb=on_text),
            audio_input=True, video_input=False,
            text_output=room_io.TextOutputOptions(sync_transcription=True),
            close_on_disconnect=True,
        ),
    )


if __name__ == "__main__":
    agents.cli.run_app(server)
