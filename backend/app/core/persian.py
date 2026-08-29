"""Persian text normalization for search.

Handles: Arabic yeh/kaf, Persian/Arabic digits, diacritics, ZWNJ,
hamza forms, extra whitespace. Kept dependency-free on purpose.
"""

import re
import unicodedata

# Character-level map
_CHAR_MAP = {
    "ي": "ی",
    "ى": "ی",
    "ئ": "ی",  # hamza-yeh folded to yeh for fuzzy match
    "ك": "ک",
    "ؤ": "و",
    "أ": "ا",
    "إ": "ا",
    "ٱ": "ا",
    "ة": "ه",
    "ۀ": "ه",
    "\u200c": " ",  # ZWNJ -> space
    "\u200f": "",  # RLM
    "\u200e": "",  # LRM
}

_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

_DIACRITICS = re.compile(r"[\u064B-\u065F\u0670\u06D6-\u06ED]")
_NON_WORD = re.compile(r"[^\w\s]")  # punctuation
_SPACES = re.compile(r"\s+")


def normalize(text: str) -> str:
    """Fully normalized form for indexing and trigram-ish matching."""
    if not text:
        return ""
    text = str(text)
    text = unicodedata.normalize("NFKC", text)
    text = "".join(_CHAR_MAP.get(ch, ch) for ch in text)
    text = text.translate(_DIGIT_MAP)
    text = _DIACRITICS.sub("", text)
    text = _NON_WORD.sub(" ", text)
    text = _SPACES.sub(" ", text).strip().lower()
    return text


def normalize_keep_digits(text: str) -> str:
    """Normalization for phone numbers: digits only."""
    if not text:
        return ""
    return "".join(ch for ch in str(text).translate(_DIGIT_MAP) if ch.isdigit())


def light_normalize(text: str) -> str:
    """For display: unify yeh/kaf/ZWNJ but keep original spacing."""
    if not text:
        return ""
    text = str(text).translate(str.maketrans({"ي": "ی", "ك": "ک"}))
    return _SPACES.sub(" ", text).strip()
