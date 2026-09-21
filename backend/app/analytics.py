"""Usage overview built from the audit trail.

Nothing new is recorded for this: every view, search, card download and sign-in
already lands in `change_log`, because the audit policy requires it. This module
only reads those rows back and counts them, so the overview can never disagree
with the log it is drawn from.

Two properties of the trail shape the arithmetic here:

* Repeated reads by one actor inside a 15-minute window are folded into a single
  row that carries a `repeats` counter (see `audit._merge_read_event`). A view is
  therefore worth `repeats`, not 1, and the row's timestamp is the first of the
  run rather than the last.
* Rows are written in UTC. Days and hours are bucketed after shifting into the
  reader's local offset, otherwise "today" starts at 3:30 in the morning.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .core.config import settings
from .models import ChangeLog, Employee, Organization, User

DIRECTORY_VIEW = "DIRECTORY_VIEW"
CARD_VIEW = "VCARD_VIEW"
LIST_VIEW = "SENSITIVE_LIST_VIEW"
LOGIN_OK = "LOGIN_SUCCESS"
LOGIN_FAIL = "LOGIN_FAILED"

VIEW_ACTIONS = (DIRECTORY_VIEW, CARD_VIEW, LIST_VIEW)
CHANGE_ACTIONS = {
    "CREATE", "UPDATE", "DELETE", "IMPORT", "bulk_delete", "BULK_DELETE",
    "create", "update", "delete", "import",
    "USER_CREATED", "USER_DELETED", "ROLE_CHANGED", "CREDENTIALS_CHANGED",
    "PASSWORD_RESET", "ACCOUNT_STATUS_CHANGED", "PASSWORD_CHANGED",
    "ORGANIZATION_CREATED", "ORGANIZATION_UPDATED", "ORGANIZATION_DELETED",
    "ORGANIZATION_KIND_CREATED", "ORGANIZATION_KIND_UPDATED", "ORGANIZATION_KIND_DELETED",
}

# A window wide enough for a year of daily bars, narrow enough that the rows for
# it still fit in memory comfortably.
MAX_DAYS = 365
MAX_ROWS = 200_000
TOP_N = 8


def _local(at: datetime | None, offset: timedelta) -> datetime | None:
    if at is None:
        return None
    aware = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
    return aware.astimezone(timezone.utc) + offset


def _repeats(details: object) -> int:
    if isinstance(details, dict):
        try:
            return max(1, int(details.get("repeats", 1)))
        except (TypeError, ValueError):
            return 1
    return 1


def _query_text(details: object) -> str:
    if isinstance(details, dict):
        return str(details.get("query", "") or "").strip()
    return ""


class _Bucket:
    """One window's tallies. Kept as a class so the current and previous
    windows are computed by exactly the same code."""

    __slots__ = ("views", "directory_views", "card_views", "list_views",
                 "searches", "logins", "failed_logins", "changes", "actors")

    def __init__(self) -> None:
        self.views = 0
        self.directory_views = 0
        self.card_views = 0
        self.list_views = 0
        self.searches = 0
        self.logins = 0
        self.failed_logins = 0
        self.changes = 0
        self.actors: set[int | str] = set()

    @staticmethod
    def _actor(row: ChangeLog) -> int | str | None:
        """Who acted, in a form that survives the account being deleted.

        Deleting a user releases `actor_id` to NULL but keeps `actor_name`, so
        counting ids alone would quietly drop every event of everyone who has
        since left. The id stays preferred: two accounts may share a name over
        time, and while the account exists the id is the exact answer.
        """
        if row.actor_id is not None:
            return row.actor_id
        name = (row.actor_name or "").strip()
        return f"name:{name}" if name and name != "anonymous" else None

    def add(self, row: ChangeLog) -> None:
        weight = _repeats(row.details)
        action = row.action
        if action == DIRECTORY_VIEW:
            self.directory_views += weight
            self.views += weight
            if _query_text(row.details):
                self.searches += weight
        elif action == CARD_VIEW:
            self.card_views += weight
            self.views += weight
        elif action == LIST_VIEW:
            self.list_views += weight
            self.views += weight
        elif action == LOGIN_OK:
            self.logins += 1
        elif action == LOGIN_FAIL:
            self.failed_logins += 1
        elif action in CHANGE_ACTIONS:
            self.changes += 1
        if action != LOGIN_FAIL:
            actor = self._actor(row)
            if actor is not None:
                self.actors.add(actor)

    def as_dict(self) -> dict:
        return {
            "views": self.views,
            "directory_views": self.directory_views,
            "card_views": self.card_views,
            "list_views": self.list_views,
            "searches": self.searches,
            "logins": self.logins,
            "failed_logins": self.failed_logins,
            "changes": self.changes,
            "active_users": len(self.actors),
        }


def _fetch(db: Session, since: datetime, until: datetime, organization_id: int | None) -> list[ChangeLog]:
    query = db.query(ChangeLog).filter(ChangeLog.at >= since, ChangeLog.at < until)
    if organization_id is not None:
        query = query.filter(ChangeLog.organization_id == organization_id)
    return query.order_by(ChangeLog.id).limit(MAX_ROWS).all()


def build_overview(db: Session, *, days: int, organization_id: int | None) -> dict:
    """Aggregate the trail for the last `days` days, plus the window before it."""
    # `days or 30` would read 0 as "unset" and quietly widen the window to a
    # month; an explicit 0 means the caller wants the smallest window there is.
    days = 30 if days is None else max(1, min(int(days), MAX_DAYS))
    offset = timedelta(minutes=settings.REPORT_UTC_OFFSET_MINUTES)
    now_local = datetime.now(timezone.utc) + offset
    # Whole local days, ending at the end of today.
    end_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    start_local = end_local - timedelta(days=days)
    prev_start_local = start_local - timedelta(days=days)

    # Back to the naive-UTC shape the rows are stored in.
    to_utc = lambda d: (d - offset).replace(tzinfo=None)  # noqa: E731
    rows = _fetch(db, to_utc(start_local), to_utc(end_local), organization_id)
    prev_rows = _fetch(db, to_utc(prev_start_local), to_utc(start_local), organization_id)

    current, previous = _Bucket(), _Bucket()
    daily: dict[str, dict[str, int]] = {}
    for i in range(days):
        day = (start_local + timedelta(days=i)).date().isoformat()
        daily[day] = {"date": day, "views": 0, "searches": 0, "logins": 0, "changes": 0}

    hourly = [0] * 24
    # Persian weeks start on Saturday; Python's weekday() starts on Monday.
    weekday = [0] * 7
    queries: Counter[str] = Counter()
    people: Counter[int] = Counter()
    actors: Counter[str] = Counter()
    actor_roles: dict[str, str] = {}
    unit_views: dict[int | None, int] = defaultdict(int)

    for row in prev_rows:
        previous.add(row)

    for row in rows:
        current.add(row)
        at = _local(row.at, offset)
        if at is None:
            continue
        weight = _repeats(row.details)
        key = at.date().isoformat()
        bucket = daily.get(key)
        is_view = row.action in VIEW_ACTIONS

        if bucket is not None:
            if is_view:
                bucket["views"] += weight
                if row.action == DIRECTORY_VIEW and _query_text(row.details):
                    bucket["searches"] += weight
            elif row.action == LOGIN_OK:
                bucket["logins"] += 1
            elif row.action in CHANGE_ACTIONS:
                bucket["changes"] += 1

        if is_view:
            hourly[at.hour] += weight
            weekday[(at.weekday() + 2) % 7] += weight
            unit_views[row.organization_id] += weight
            if row.action == CARD_VIEW and row.entity_id:
                people[row.entity_id] += weight
            term = _query_text(row.details)
            if term:
                queries[term] += weight

        if row.actor_name and row.action != LOGIN_FAIL:
            actors[row.actor_name] += weight if is_view else 1
            if row.actor_role:
                actor_roles[row.actor_name] = row.actor_role

    names = _employee_names(db, list(people), organization_id)
    units = _unit_names(db)

    return {
        "range": {
            "days": days,
            "from": start_local.date().isoformat(),
            "to": (end_local - timedelta(days=1)).date().isoformat(),
            "truncated": len(rows) >= MAX_ROWS,
        },
        "totals": current.as_dict(),
        "previous": previous.as_dict(),
        "daily": list(daily.values()),
        "hourly": [{"hour": h, "views": v} for h, v in enumerate(hourly)],
        "weekday": [{"day": d, "views": v} for d, v in enumerate(weekday)],
        "top_queries": [{"term": t, "count": c} for t, c in queries.most_common(TOP_N)],
        "top_people": [
            {"id": pid, "name": names.get(pid, f"#{pid}"), "count": c}
            for pid, c in people.most_common(TOP_N)
        ],
        "top_actors": [
            {"name": n, "role": actor_roles.get(n, ""), "count": c}
            for n, c in actors.most_common(TOP_N)
        ],
        "by_unit": sorted(
            (
                {"id": uid, "name": units.get(uid, "بدون واحد"), "views": v}
                for uid, v in unit_views.items()
            ),
            key=lambda x: x["views"],
            reverse=True,
        ),
        "directory": _directory_size(db, organization_id),
    }


def _employee_names(db: Session, ids: list[int], organization_id: int | None) -> dict[int, str]:
    if not ids:
        return {}
    query = db.query(Employee).filter(Employee.id.in_(ids))
    if organization_id is not None:
        query = query.filter(Employee.organization_id == organization_id)
    return {emp.id: emp.full_name or f"#{emp.id}" for emp in query.all()}


def _unit_names(db: Session) -> dict[int | None, str]:
    return {org.id: org.name for org in db.query(Organization).all()}


def _directory_size(db: Session, organization_id: int | None) -> dict:
    """What the usage numbers are measured against."""
    emp = db.query(Employee)
    usr = db.query(User)
    org = db.query(Organization)
    if organization_id is not None:
        emp = emp.filter(Employee.organization_id == organization_id)
        usr = usr.filter(User.organization_id == organization_id)
        org = org.filter(Organization.id == organization_id)
    accounts = usr.all()
    return {
        "employees": emp.count(),
        "accounts": len(accounts),
        "active_accounts": sum(1 for u in accounts if u.is_active),
        "units": org.count(),
    }
