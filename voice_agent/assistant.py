"""Conversation behavior shared by voice and typed input."""
import logging
from collections.abc import AsyncIterable, Awaitable, Callable
from contextlib import aclosing

from livekit import rtc
from livekit.agents import Agent, ModelSettings, llm, stt

from .config import Settings
from .forms import DemoForm
from .greeting import GreetingAudio
from .runtime_context import with_runtime_context
from .web_search import SearchResult, make_search_tool

logger = logging.getLogger(__name__)


class PortraitAgent(Agent):
    def __init__(
        self, settings: Settings,
        publish_search: Callable[[SearchResult], Awaitable[None]] | None = None,
        greeting: GreetingAudio | None = None,
        form: DemoForm | None = None,
    ):
        self.settings = settings
        self.greeting = greeting
        self.form = form or DemoForm()
        super().__init__(
            instructions=settings.prompt(),
            tools=([make_search_tool(settings, publish_search)] if settings.can_search_web else [])
            + self.form.tools(),
        )

    async def on_enter(self) -> None:
        if self.settings.agent_greeting:
            if self.greeting:
                self.session.say(self.settings.agent_greeting, audio=self.greeting.frames(), allow_interruptions=True)
            else:
                self.session.say(self.settings.agent_greeting, allow_interruptions=True)

    async def stt_node(self, audio: AsyncIterable[rtc.AudioFrame], model_settings: ModelSettings):
        async def measured_audio():
            received = audible = False
            async for frame in audio:
                peak = max(map(abs, frame.data), default=0) if not audible else 0
                if not received:
                    received = True
                    logger.info("Microphone audio received", extra={
                        "input_sample_rate": frame.sample_rate,
                        "input_channels": frame.num_channels,
                        "input_peak": peak,
                    })
                if not audible and peak > 300:
                    audible = True
                    logger.info("Microphone signal detected", extra={"input_peak": peak})
                yield frame

        transcribed = False
        async with aclosing(Agent.default.stt_node(self, measured_audio(), model_settings)) as stream:
            async for event in stream:
                if event.type == stt.SpeechEventType.FINAL_TRANSCRIPT:
                    logger.info("Speech recognition finalized", extra={
                        "transcript_characters": sum(len(item.text) for item in event.alternatives),
                    })
                elif not transcribed and event.alternatives:
                    transcribed = True
                    logger.info("Speech recognition started")
                yield event

    def llm_node(
        self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings: ModelSettings,
    ):
        # This hook also covers generate_reply(user_input=...), tool follow-ups,
        # and a session crossing midnight. A speech-only hook would miss typed chat.
        context = with_runtime_context(chat_ctx, self.settings)
        if form_context := self.form.context():
            context.add_message(role="system", content=form_context)
        return Agent.default.llm_node(self, context, tools, model_settings)
