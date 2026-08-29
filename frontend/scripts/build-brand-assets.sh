#!/usr/bin/env bash
# دارایی‌های برند را از نشان شفافِ اصلی می‌سازد.
#
# متنِ امضای «Business Development & Technology» در رابط با فونت واقعی
# نوشته می‌شود تا در هر اندازه خوانا و دسترس‌پذیر بماند. این اسکریپت فقط
# نشان C را برای سربرگ و آیکون‌های نصب‌شونده از یک منبع می‌سازد:
#
#   ./scripts/build-brand-assets.sh [path/to/transparent-C-mark.png]
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-src/assets/cpi-brand-mark.png}"
OUT="public"
[ -f "$SRC" ] || { echo "منبع پیدا نشد: $SRC" >&2; exit 1; }
command -v magick >/dev/null || { echo "ImageMagick لازم است: brew install imagemagick" >&2; exit 1; }

# آستانه‌ی آلفا تا پیکسل‌های کاملاً محو جزو کادر نشان حساب نشوند.
BOX=$(magick "$SRC" -alpha extract -threshold 4% -format "%@" info:)
MW=${BOX%%x*}; rest=${BOX#*x}
MH=${rest%%+*}; rest=${rest#*+}
MX=${rest%%+*}; MY=${rest#*+}
echo "▸ کادرِ نشان: ${MW}×${MH} در (${MX},${MY})"

# ۲۵۶ رنگ: در بزرگ‌ترین اندازه‌ای که این تصویرها دیده می‌شوند تفاوتش
# با رنگِ کامل نامرئی است (RMSE ≈ ۱٪) ولی حجم را چهار برابر کم می‌کند.
# حجم اینجا مهم است چون سرویس‌ورکر همه‌ی public را precache می‌کند.
# آخرین آرگومان مقصد است؛ بقیه عملیاتِ تصویرند.
mark() {
  local out="${*: -1}"
  local ops=("${@:1:$#-1}")
  magick "$SRC" -crop "${MW}x${MH}+${MX}+${MY}" +repage \
    "${ops[@]}" -colors 256 -strip "$out"
}

# نشانِ تنها، پس‌زمینه شفاف — سربرگ‌ها و صفحه‌ی ورود.
# ۳۸۴ پیکسل: بزرگ‌ترین نمایشِ درون‌برنامه‌ای ۸۰px است، یعنی ۳× هم جا دارد.
mark -resize 384x384 "$OUT/brand-mark.png"

# آیکون‌ها: نشان وسطِ بومِ مربعِ سفید. سفید چون کلِ محصول «کاغذِ سفید»
# است و background_color مانیفست هم سفید است؛ آیکونِ شفاف روی
# پس‌زمینه‌ی ناشناخته می‌افتد و نتیجه‌اش قابل پیش‌بینی نیست.
square() { # <side> <content-ratio> <out>
  local side=$1 ratio=$2 out=$3
  local box; box=$(awk "BEGIN{printf \"%d\", $side * $ratio}")
  mark -resize "${box}x${box}" \
    -background white -gravity center -extent "${side}x${side}" \
    "$OUT/$out"
}

# «any» — کمی حاشیه تا نشان به لبه نچسبد
square 512 0.84 icon-512.png
square 192 0.84 icon-192.png
square 180 0.80 apple-touch-icon.png
square  32 0.88 favicon-32.png
square  16 0.90 favicon-16.png

# «maskable» — اندروید آیکون را می‌برد؛ محتوا باید در ۸۰٪ مرکزی جا شود
square 512 0.62 icon-maskable-512.png

echo "▸ ساخته شد:"
for f in brand-mark.png icon-512.png icon-192.png icon-maskable-512.png \
         apple-touch-icon.png favicon-32.png favicon-16.png; do
  printf '   %-24s %7s  %s\n' "$f" \
    "$(du -h "$OUT/$f" | cut -f1)" \
    "$(magick identify -format '%wx%h' "$OUT/$f")"
done
