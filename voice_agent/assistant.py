"""Conversation behavior shared by voice and typed input."""
from collections.abc import Awaitable, Callable

from livekit.agents import Agent, ModelSettings, llm

from .config import Settings
from .runtime_context import with_runtime_context
from .web_search import SearchResult, make_search_tool


class PortraitAgent(Agent):
    def __init__(
        self, settings: Settings,
        publish_search: Callable[[SearchResult], Awaitable[None]] | None = None,
    ):
        self.settings = settings
        super().__init__(
            instructions=settings.prompt(),
            tools=[make_search_tool(settings, publish_search)] if settings.can_search_web else [],
        )

    async def on_enter(self) -> None:
        if self.settings.agent_greeting:
            self.session.say(self.settings.agent_greeting, allow_interruptions=True)

    def llm_node(
        self, chat_ctx: llm.ChatContext, tools: list[llm.Tool], model_settings: ModelSettings,
    ):
        # This hook also covers generate_reply(user_input=...), tool follow-ups,
        # and a session crossing midnight. A speech-only hook would miss typed chat.
        return Agent.default.llm_node(
            self, with_runtime_context(chat_ctx, self.settings), tools, model_settings,
        )
