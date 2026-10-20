"""Fresh wall-clock context for every LLM request, including typed chat and tool replies."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from livekit.agents import llm

from .config import Settings

CONTEXT_ID = "portrait_runtime_context"
WEEKDAYS = ("Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật")


def runtime_context(settings: Settings, now: datetime | None = None) -> str:
    zone = ZoneInfo(settings.agent_timezone)
    if now is not None and now.tzinfo is None:
        raise ValueError("An injected clock must have an explicit time zone")
    local = now.astimezone(zone) if now is not None else datetime.now(zone)
    yesterday, tomorrow = local.date() - timedelta(days=1), local.date() + timedelta(days=1)
    search = (
        "Có công cụ search_current_information để tra cứu web khi cần thông tin mới."
        if settings.can_search_web else
        "Hiện không có công cụ tra cứu web. Không xác nhận tin mới hoặc dữ liệu trực tiếp."
    )
    return (
        "NGỮ CẢNH HIỆN TẠI DO HỆ THỐNG CUNG CẤP\n"
        f"Múi giờ: {settings.agent_timezone}.\n"
        f"Hôm nay: {WEEKDAYS[local.weekday()]}, ngày {local:%d/%m/%Y}.\n"
        f"Thời điểm hiện tại (ISO 8601): {local.isoformat(timespec='seconds')}.\n"
        f"Hôm qua: {yesterday:%d/%m/%Y}. Ngày mai: {tomorrow:%d/%m/%Y}.\n"
        "Đây là thời gian hiện tại, không phải mốc kiến thức của mô hình. "
        "Nếu hội thoại trước chứa ngày khác cho hôm nay, hãy đính chính theo ngữ cảnh này.\n"
        + search
    )


def with_runtime_context(
    chat_ctx: llm.ChatContext, settings: Settings, now: datetime | None = None,
) -> llm.ChatContext:
    context = chat_ctx.copy()
    context.items = [item for item in context.items if item.id != CONTEXT_ID]
    context.add_message(role="system", content=runtime_context(settings, now), id=CONTEXT_ID)
    return context
