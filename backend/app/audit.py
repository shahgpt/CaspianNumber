"""Central append-only audit helpers."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy.orm import Session

from .models import ChangeLog, User

_ACTOR_ORGANIZATION = object()

# Read events must stay on the record, but one search per keystroke would bury
# every real change under them. Repeats by the same actor on the same list
# inside this window fold into the first row and bump its counter instead.
READ_ACTIONS = {"DIRECTORY_VIEW", "SENSITIVE_LIST_VIEW", "VCARD_VIEW"}
READ_COLLAPSE_WINDOW = timedelta(minutes=15)


def audit_event(
    db: Session,
    *,
    action: str,
    entity: str,
    actor: User | None = None,
    organization_id: int | None | object = _ACTOR_ORGANIZATION,
    entity_id: int | None = None,
    request: Request | None = None,
    details: dict | None = None,
    target_user_id: int | None = None,
    role_before: str | None = None,
    role_after: str | None = None,
) -> ChangeLog:
    resolved_organization_id = (
        getattr(actor, "organization_id", None)
        if organization_id is _ACTOR_ORGANIZATION
        else organization_id
    )
    if action in READ_ACTIONS and actor is not None:
        merged = _merge_read_event(
            db,
            action=action,
            entity=entity,
            entity_id=entity_id,
            actor=actor,
            organization_id=resolved_organization_id,
            details=details,
        )
        if merged is not None:
            return merged

    row = ChangeLog(
        organization_id=resolved_organization_id,
        entity=entity,
        entity_id=entity_id,
        action=action,
        actor_id=getattr(actor, "id", None),
        actor_name=getattr(actor, "username", "anonymous"),
        actor_role=getattr(actor, "role", None),
        target_user_id=target_user_id,
        role_before=role_before,
        role_after=role_after,
        ip_address=request.client.host if request and request.client else None,
        user_agent=(request.headers.get("user-agent", "")[:255] or None) if request else None,
        details=details,
    )
    db.add(row)
    return row


def _merge_read_event(
    db: Session,
    *,
    action: str,
    entity: str,
    entity_id: int | None,
    actor: User,
    organization_id: int | None,
    details: dict | None,
) -> ChangeLog | None:
    """Fold a repeated read into the actor's most recent matching row."""
    row = (
        db.query(ChangeLog)
        .filter(
            ChangeLog.action == action,
            ChangeLog.entity == entity,
            ChangeLog.entity_id.is_(None) if entity_id is None else ChangeLog.entity_id == entity_id,
            ChangeLog.actor_id == actor.id,
            ChangeLog.organization_id.is_(None)
            if organization_id is None
            else ChangeLog.organization_id == organization_id,
        )
        .order_by(ChangeLog.id.desc())
        .first()
    )
    if row is None or row.at is None:
        return None
    at = row.at if row.at.tzinfo else row.at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - at > READ_COLLAPSE_WINDOW:
        return None

    merged = dict(row.details or {})
    merged.update(details or {})
    merged["repeats"] = int(merged.get("repeats", 1)) + 1
    # Reassigning is required: SQLAlchemy does not track mutations inside JSON.
    row.details = merged
    return row
