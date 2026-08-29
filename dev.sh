#!/usr/bin/env bash
# توسعه: بک‌اند (8899) + Vite dev server با هات‌ریلود (5173)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x backend/.venv/bin/python ]; then
  echo "▸ ساخت محیط پایتون…"
  uv venv --python 3.11 backend/.venv
  uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
fi

if [ ! -d frontend/node_modules ]; then
  echo "▸ نصب پکیج‌های فرانت…"
  (cd frontend && npm install --no-audit --no-fund)
fi

echo "▸ API docs:  http://127.0.0.1:8899/docs"
echo "▸ Frontend:  http://localhost:5173  (Ctrl+C برای توقف هر دو)"

(cd backend && ../backend/.venv/bin/python -m uvicorn app.main:app --port 8899 --reload) &
BACK_PID=$!
trap 'kill $BACK_PID 2>/dev/null' EXIT

(cd frontend && npm run dev) &
FRONT_PID=$!
trap 'kill $BACK_PID $FRONT_PID 2>/dev/null' EXIT

wait
