"""Use model-supported thinking controls for short spoken responses."""
from google.genai import types


def fast_thinking_config(model: str) -> types.ThinkingConfig | None:
    model = model.lower().rsplit("/", 1)[-1]
    if model.startswith("gemini-2.5-flash"):
        return types.ThinkingConfig(thinking_budget=0)
    if model.startswith("gemini-2.5-pro"):
        return types.ThinkingConfig(thinking_budget=128)
    if model.startswith("gemini-3"):
        # Pro does not accept minimal; newer Flash families may require low.
        level = "minimal" if model.startswith(("gemini-3-flash", "gemini-3.1-flash")) else "low"
        return types.ThinkingConfig(thinking_level=level)
    return None
