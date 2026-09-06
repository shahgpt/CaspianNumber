"""single root administrator replaces the grantable manage_global_admins flag

A permission that can be handed out is a permission that spreads: any head-office
user holding `manage_global_admins` could mint global admins, and grant the flag
onward. `is_root` is written once at bootstrap and reachable through no API.

Revision ID: 20260906_03
Revises: 20260906_02
"""
from alembic import op
import sqlalchemy as sa

revision = "20260906_03"
down_revision = "20260906_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("users")}

    if "is_root" not in columns:
        op.add_column("users", sa.Column(
            "is_root", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Carry the old flag over so the upgrade never leaves the system with no
    # account able to manage global admins; bootstrap then pins it to one.
    if "manage_global_admins" in columns:
        bind.execute(sa.text("UPDATE users SET is_root = 1 WHERE manage_global_admins = 1"))
        with op.batch_alter_table("users") as batch:
            batch.drop_column("manage_global_admins")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column(
            "manage_global_admins", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.get_bind().execute(sa.text("UPDATE users SET manage_global_admins = is_root"))
    with op.batch_alter_table("users") as batch:
        batch.drop_column("is_root")
