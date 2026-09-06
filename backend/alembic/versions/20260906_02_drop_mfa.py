"""drop two-factor columns

Two-factor authentication was removed from the product; the columns it kept on
`users` are dead schema. Dropping them also discards the stored TOTP secrets,
which is the point: nothing should keep a secret it no longer uses.

Revision ID: 20260906_02
Revises: 20260905_01
"""
from alembic import op
import sqlalchemy as sa

revision = "20260906_02"
down_revision = "20260905_01"
branch_labels = None
depends_on = None

COLUMNS = ("mfa_enabled", "mfa_secret_enc", "mfa_recovery_hashes")


def upgrade() -> None:
    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("users")}
    # batch_alter_table is required on SQLite, which cannot DROP COLUMN in place
    # on older engines; it is a no-op wrapper elsewhere.
    with op.batch_alter_table("users") as batch:
        for name in COLUMNS:
            if name in existing:
                batch.drop_column(name)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("mfa_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("mfa_secret_enc", sa.Text(), nullable=True))
        batch.add_column(sa.Column("mfa_recovery_hashes", sa.JSON(), nullable=False, server_default="[]"))
