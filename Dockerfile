# ---- Stage 1: build the React PWA ----
FROM node:20-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: FastAPI + built assets ----
FROM python:3.11-slim
WORKDIR /srv

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic
COPY --from=frontend /app/dist ./frontend/dist

ENV FRONTEND_DIST=/srv/frontend/dist \
    DATABASE_URL=sqlite:////data/caspian.db

RUN useradd --system --create-home --home-dir /home/caspian caspian \
    && mkdir -p /data \
    && chown -R caspian:caspian /srv /data

VOLUME ["/data"]
EXPOSE 8899
USER caspian

CMD ["sh", "-c", "python -m alembic -c /srv/alembic.ini upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8899"]
