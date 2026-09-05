"""Central append-only audit helpers."""
from __future__ import annotations

from fastapi import Request
from sqlalchemy.orm import Session

from .models import ChangeLog, User

_ACTOR_ORGANIZATION = object()


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
