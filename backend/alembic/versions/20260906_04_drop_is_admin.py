"""drop the legacy is_admin column

`is_admin` became a property computed from `role`, so the ORM stopped writing it.
On databases created by the old `create_all` the column survives as NOT NULL with
no SQL default — SQLAlchemy's `default=False` was client-side and never reached
the DDL — and every INSERT into `users` fails. Upgrades converted the flag into a
role long ago; what is left is dead schema that only breaks writes.

Revision ID: 20260906_04
Revises: 20260906_03
"""
from alembic import op
import sqlalchemy as sa

revision = "20260906_04"
down_revision = "20260906_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "is_admin" not in {c["name"] for c in sa.inspect(bind).get_columns("users")}:
        return
    # Last chance to carry the old flag into a role, in case a database reached
    # this revision without the earlier conversion having applied.
    bind.execute(sa.text(
        "UPDATE users SET role='UNIT_MANAGER', can_delete_data=1 "
        "WHERE is_admin=1 AND role='UNIT_USER'"
    ))
    with op.batch_alter_table("users") as batch:
        batch.drop_column("is_admin")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column(
            "is_admin", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.get_bind().execute(sa.text(
        "UPDATE users SET is_admin=1 "
        "WHERE role IN ('UNIT_MANAGER','HEAD_OFFICE_ACCESS_ADMIN','GLOBAL_ADMIN')"
    ))
