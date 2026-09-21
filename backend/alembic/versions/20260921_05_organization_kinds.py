"""unit types become a managed lookup table

`organizations.kind` used to be a closed set of two literals in the source, so
adding a third type of unit meant editing and redeploying. This introduces
`organization_kinds` and seeds it from whatever the installation already uses:
the two built-in rows, plus a row for any `kind` string already stored, so no
existing unit is left pointing at a type that is not listed.

Revision ID: 20260921_05
Revises: 20260906_04
"""
from alembic import op
import sqlalchemy as sa

revision = "20260921_05"
down_revision = "20260906_04"
branch_labels = None
depends_on = None

SYSTEM_KINDS = (("HEAD_OFFICE", "دفتر مرکزی", 0), ("FACTORY", "کارخانه", 1))


def upgrade() -> None:
    bind = op.get_bind()
    if "organization_kinds" not in sa.inspect(bind).get_table_names():
        op.create_table(
            "organization_kinds",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("code", sa.String(length=24), nullable=False),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("100")),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("code", name="uq_organization_kinds_code"),
        )
        op.create_index("ix_organization_kinds_code", "organization_kinds", ["code"])

    existing = {row[0] for row in bind.execute(sa.text("SELECT code FROM organization_kinds"))}
    insert = sa.text(
        "INSERT INTO organization_kinds(code, name, is_system, sort_order) "
        "VALUES (:code, :name, :is_system, :sort_order)"
    )
    for code, name, order in SYSTEM_KINDS:
        if code not in existing:
            bind.execute(insert, {"code": code, "name": name, "is_system": True, "sort_order": order})
            existing.add(code)

    # Whatever this installation already stores stays selectable, under its own
    # code as a provisional label the admin can rename.
    for (kind,) in bind.execute(sa.text("SELECT DISTINCT kind FROM organizations WHERE kind IS NOT NULL")):
        if kind and kind not in existing:
            bind.execute(insert, {"code": kind, "name": kind, "is_system": False, "sort_order": 100})
            existing.add(kind)


def downgrade() -> None:
    op.drop_index("ix_organization_kinds_code", table_name="organization_kinds")
    op.drop_table("organization_kinds")
