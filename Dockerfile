# Console: React build + FastAPI in one container (App Runner / ECS / any container host).
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY sim sim
COPY data data
COPY media-service media-service
COPY --from=web /web/dist frontend/dist
ENV F2F_STATE_DIR=/app/.state F2F_KEYS_DIR=/app/.keys
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
