"""FTS5 full-text index over employees.search_text — fast, ranked retrieval.

SQLite FTS5 gives us proper tokenized matching with BM25 ranking instead of
LIKE substring scans. The index is kept in sync via explicit rebuild calls
(cheap at phonebook scale) from admin mutations and import.
"""
import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

from .core.persian import normalize_keep_digits

logger = logging.getLogger("caspian.fts")

FTS_TABLE = "employees_fts"

# Persian doesn't have a built-in tokenizer in SQLite; unicode61 works well
# enough on our normalized corpus (spaces separate words after normalize()).
_CREATE_SQL = f"""
CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} USING fts5(
    employee_id UNINDEXED,
    search_text,
    tokenize='unicode61'
)
"""


def _available(db: Session) -> bool:
    try:
        db.execute(text(_CREATE_SQL))
        return True
    except Exception:
        logger.warning("FTS5 not available — falling back to LIKE search", exc_info=True)
        return False


def reindex_all(db: Session) -> int:
    """Rebuild the whole FTS index from employees.search_text."""
    if not _available(db):
        return 0
    db.execute(text(f"DELETE FROM {FTS_TABLE}"))
    db.execute(
        text(
            f"INSERT INTO {FTS_TABLE}(employee_id, search_text) "
            "SELECT id, search_text FROM employees"
        )
    )
    db.commit()
    n = db.execute(text(f"SELECT count(*) FROM {FTS_TABLE}")).scalar() or 0
    return int(n)


def upsert_employee(db: Session, employee_id: int, search_text: str) -> None:
    if not _available(db):
        return
    db.execute(
        text(f"DELETE FROM {FTS_TABLE} WHERE employee_id = :eid"),
        {"eid": employee_id},
    )
    db.execute(
        text(
            f"INSERT INTO {FTS_TABLE}(employee_id, search_text) VALUES (:eid, :txt)"
        ),
        {"eid": employee_id, "txt": search_text or ""},
    )


def delete_employee(db: Session, employee_id: int) -> None:
    if not _available(db):
        return
    db.execute(
        text(f"DELETE FROM {FTS_TABLE} WHERE employee_id = :eid"),
        {"eid": employee_id},
    )


def _fts_query(terms: list[str], digits: str) -> str:
    """Build a safe FTS5 MATCH expression: prefix-match each term."""
    parts = []
    for t in terms:
        # escape double quotes inside term
        safe = t.replace('"', '""')
        parts.append(f'"{safe}"*')
    if digits and len(digits) >= 3:
        parts.append(f'"{digits}"*')
    return " OR ".join(parts)


def fts_search_ids(db: Session, terms: list[str], digits: str = "", limit: int = 300) -> list[int]:
    """Return ranked employee ids matching any term (BM25 order)."""
    if not _available(db):
        return []
    match = _fts_query(terms, digits)
    if not match:
        return []
    try:
        rows = db.execute(
            text(
                f"SELECT employee_id FROM {FTS_TABLE} WHERE {FTS_TABLE} MATCH :m "
                "ORDER BY rank LIMIT :lim"
            ),
            {"m": match, "lim": limit},
        ).fetchall()
        return [r[0] for r in rows]
    except Exception:
        logger.warning("FTS match failed for %r", match, exc_info=True)
        return []


__all__ = [
    "reindex_all",
    "upsert_employee",
    "delete_employee",
    "fts_search_ids",
    "normalize_keep_digits",
]
