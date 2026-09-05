"""organization isolation, RBAC, MFA and audit metadata

Revision ID: 20260905_01
Revises:
"""
from alembic import op
import sqlalchemy as sa

revision = "20260905_01"
down_revision = None
branch_labels = None
depends_on = None


def _columns(inspector, table):
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    from app.models import Base
    # Also makes this migration a complete bootstrap for a fresh database.
    Base.metadata.create_all(bind)
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "organizations" in tables:
        bind.execute(sa.text(
            "INSERT INTO organizations (id,name,code,kind,is_active) "
            "SELECT 1,'دفتر مرکزی','HEAD','HEAD_OFFICE',1 "
            "WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id=1)"
        ))

    additions = {
        "employees": [sa.Column("organization_id", sa.Integer(), nullable=False, server_default="1")],
        "users": [
            sa.Column("organization_id", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("role", sa.String(40), nullable=False, server_default="UNIT_USER"),
            sa.Column("manage_global_admins", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("can_delete_data", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("mfa_secret_enc", sa.Text(), nullable=True),
            sa.Column("mfa_recovery_hashes", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        ],
        "change_log": [
            sa.Column("organization_id", sa.Integer(), nullable=True),
            sa.Column("actor_role", sa.String(40), nullable=True),
            sa.Column("target_user_id", sa.Integer(), nullable=True),
            sa.Column("role_before", sa.String(40), nullable=True),
            sa.Column("role_after", sa.String(40), nullable=True),
            sa.Column("ip_address", sa.String(64), nullable=True),
            sa.Column("user_agent", sa.String(255), nullable=True),
        ],
    }
    for table, columns in additions.items():
        existing = _columns(inspector, table)
        for column in columns:
            if column.name not in existing:
                op.add_column(table, column)

    user_cols = _columns(sa.inspect(bind), "users")
    if "is_admin" in user_cols:
        bind.execute(sa.text(
            "UPDATE users SET role='UNIT_MANAGER', can_delete_data=1 "
            "WHERE is_admin=1 AND role='UNIT_USER'"
        ))
    bind.execute(sa.text("UPDATE change_log SET organization_id=1 WHERE organization_id IS NULL"))
    action_type = next(
        (column["type"] for column in sa.inspect(bind).get_columns("change_log") if column["name"] == "action"),
        None,
    )
    if bind.dialect.name != "sqlite" and getattr(action_type, "length", 40) < 40:
        op.alter_column("change_log", "action", existing_type=action_type, type_=sa.String(40))

    inspector = sa.inspect(bind)
    wanted_indexes = {
        "users": [("ix_users_organization_id", ["organization_id"]),
                  ("ix_users_organization_role", ["organization_id", "role"])],
        "employees": [("ix_employees_organization_id", ["organization_id"]),
                      ("ix_employees_org_last_name", ["organization_id", "last_name", "id"])],
        "change_log": [("ix_change_log_organization_id", ["organization_id"]),
                       ("ix_audit_org_at", ["organization_id", "at"]),
                       ("ix_audit_actor_at", ["actor_id", "at"])],
    }
    for table, indexes in wanted_indexes.items():
        existing_indexes = {idx["name"] for idx in inspector.get_indexes(table)}
        for name, columns in indexes:
            if name not in existing_indexes:
                op.create_index(name, table, columns, unique=False)


def downgrade() -> None:
    # Intentionally preserve tenant/audit data. A destructive downgrade must be a
    # separately reviewed data-migration, not an automatic schema command.
    pass
