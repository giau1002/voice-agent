FROM node:24-bookworm-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci --no-fund
COPY web/ ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:0.13.3 AS uv
FROM python:3.12-slim-bookworm
COPY --from=uv /uv /uvx /usr/local/bin/
WORKDIR /app
ENV PYTHONUNBUFFERED=1 UV_LINK_MODE=copy HF_HOME=/app/.cache/huggingface
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY voice_agent/ ./voice_agent/
COPY prompts/ ./prompts/
RUN uv run --frozen --no-dev -m livekit.agents download-files
COPY --from=web /web/dist ./web/dist
RUN useradd --create-home app && chown -R app:app /app
USER app
EXPOSE 8790
CMD ["uv", "run", "--frozen", "--no-dev", "uvicorn", "voice_agent.api:app", "--host", "0.0.0.0", "--port", "8790"]
