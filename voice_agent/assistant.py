"""Conversation behavior shared by voice and typed input."""
from collections.abc import Awaitable, Callable

from livekit.agents import Agent, ModelSettings, llm

from .config import Settings
from .forms import DemoForm
from .greeting import GreetingAudio
from .runtime_context import with_runtime_context
from .web_search import SearchResult, make_search_tool


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

    def llm_node(
        self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings: ModelSettings,
    ):
        # This hook also covers generate_reply(user_input=...), tool follow-ups,
        # and a session crossing midnight. A speech-only hook would miss typed chat.
        context = with_runtime_context(chat_ctx, self.settings)
        if form_context := self.form.context():
            context.add_message(role="system", content=form_context)
        return Agent.default.llm_node(self, context, tools, model_settings)
