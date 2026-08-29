"""Search service: normalized LIKE scoring (works on SQLite and Postgres).

Strategy: strip Persian stopwords, then score employees by how many query
terms hit their normalized search corpus. All-terms hits rank above
single-term hits, so natural questions like «کی مسئول استخدام هست؟» work.
"""
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from . import fts
from .core.persian import normalize, normalize_keep_digits
from .models import Employee

# Common filler words in natural-language questions — ignored in matching
STOPWORDS = {
    "کی", "چه", "کدام", "که", "هست", "است", "بود", "شده",
    "را", "رو", "به", "از", "در", "با", "برای", "و", "یا",
    "این", "اون", "ان", "من", "تو", "ما", "شما",
    "می", "میخوام", "می‌خوام", "خواستم", "لطفا", "لطفا",
    "شماره", "عدد", "نفر", "شخص", "همکار", "همكار", "کارمند",
    "مسول", "مسئول",
    "میکنه", "می‌کنه", "کنه", "میکنم",
}

# fields whose direct hit carries extra weight
_WEIGHTS = [
    ("keywords", 6),
    ("job_title", 5),
    ("department", 5),
    ("skills", 3),
]


def _significant_terms(query: str) -> list[str]:
    norm_q = normalize(query)
    terms = []
    for t in norm_q.split():
        if t in STOPWORDS:
            continue
        if len(t) == 1:
            continue
        terms.append(t)
    return terms


def _corpus_words(employee: Employee) -> set[str]:
    return set((employee.search_text or "").split())


def _term_hits(term: str, words: set[str]) -> bool:
    if term in words:
        return True
    if len(term) >= 3:
        # prefix match catches morphological variants (استخدام / استخدامی)
        # substring match catches attached suffixes (خرید / خریده)
        return any(w.startswith(term) or term in w for w in words)
    return False


def _score(employee: Employee, terms: list[str], raw_query: str) -> int:
    text = employee.search_text or ""
    if not terms:
        # pure-stopword/pure-digit query: rank by raw substring presence
        return 5 if normalize(raw_query) and normalize(raw_query) in text else 0
    words = set(text.split())
    if not words:
        return 0

    hits = sum(1 for t in terms if _term_hits(t, words))
    if hits == 0:
        return 0

    score = hits * 10
    if hits == len(terms):
        score += 15  # every significant term matched

    # direct high-value field hits
    for field, weight in _WEIGHTS:
        val = getattr(employee, field, "") or ""
        nv = set(normalize(val).split())
        if nv and any(_term_hits(t, nv) for t in terms):
            score += weight

    # name proximity boost
    full_norm = normalize(employee.full_name)
    if full_norm and all(t in full_norm for t in terms):
        score += 20

    # phone/extension digit hit
    digits = normalize_keep_digits(raw_query)
    if digits and len(digits) >= 3:
        emp_digits = " ".join(
            filter(None, [
                normalize_keep_digits(employee.direct or ""),
                normalize_keep_digits(employee.extension or ""),
                normalize_keep_digits(employee.phone or ""),
            ])
        )
        if digits in emp_digits:
            score += 40
    return score


def search_employees(db: Session, query: str, limit: int = 30):
    q = (query or "").strip()
    if not q:
        return []

    norm_q = normalize(q)
    terms = _significant_terms(q)
    digits = normalize_keep_digits(q)

    # candidate pre-filter: FTS5 (BM25-ranked) when available, LIKE otherwise
    ids = fts.fts_search_ids(db, terms, digits)
    if ids:
        by_id = {e.id: e for e in db.query(Employee).filter(Employee.id.in_(ids)).all()}
        candidates = [by_id[i] for i in ids if i in by_id]
    else:
        filters = []
        for t in terms:
            filters.append(Employee.search_text.ilike(f"%{t}%"))
        if digits and len(digits) >= 3:
            filters.append(Employee.search_text.ilike(f"%{digits}%"))
        if not filters:
            # pure-stopword query: fall back to raw substring
            filters.append(Employee.search_text.ilike(f"%{norm_q}%"))

        candidates = (
            db.query(Employee)
            .filter(or_(*filters))
            .limit(300)
            .all()
        )

    scored = [(emp, _score(emp, terms, q)) for emp in candidates]
    scored = [(e, s) for e, s in scored if s > 0]
    scored.sort(key=lambda pair: pair[1], reverse=True)

    # if nothing survived scoring (e.g. only digits matched), show candidates as-is
    if not scored and digits and len(digits) >= 3:
        return candidates[:limit]
    return [emp for emp, _ in scored[:limit]]
