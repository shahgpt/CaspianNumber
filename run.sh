#!/usr/bin/env bash
# اجرای کامل کاسپین نامبر — بک‌اند + فرانتِ بیلدشده روی http://127.0.0.1:8899
# استفاده:  ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

# ۱) محیط پایتون (اولین بار خودکار ساخته می‌شود)
if [ ! -x backend/.venv/bin/python ]; then
  echo "▸ ساخت محیط پایتون…"
  uv venv --python 3.11 backend/.venv
  uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
fi

# ۲) فرانت بیلدشده — «نبودن» شرطِ کافی نیست: اگر سورس از باندل تازه‌تر باشد
#    هم باید دوباره بیلد شود، وگرنه ری‌استارتِ سرور باندلِ کهنه را سرو می‌کند.
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src frontend/index.html frontend/package.json frontend/vite.config.ts frontend/tailwind.config.js -newer frontend/dist/index.html 2>/dev/null)" ]; then
  echo "▸ بیلد فرانت‌اند…"
  [ -d frontend/node_modules ] || (cd frontend && npm install --no-audit --no-fund)
  (cd frontend && npm run build)
fi

# ۳) سرور
echo "▸ کاسپین نامبر: http://127.0.0.1:8899  (Ctrl+C برای توقف)"
cd backend
exec .venv/bin/python -m uvicorn app.main:app --port "${PORT:-8899}"
