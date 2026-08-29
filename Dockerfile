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
COPY --from=frontend /app/dist ./frontend/dist

ENV FRONTEND_DIST=/srv/frontend/dist \
    DATABASE_URL=sqlite:////data/caspian.db

VOLUME ["/data"]
EXPOSE 8899

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8899"]
