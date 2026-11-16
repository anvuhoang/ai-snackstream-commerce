"""Add the allergen, spice level and nutrition text a person reads off the real package.

Revision ID: 0011
Revises: 0010
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("product") as batch:
        batch.add_column(sa.Column("allergens", sa.Text(), nullable=False, server_default=""))
        batch.add_column(sa.Column("spice_level", sa.String(length=30), nullable=False, server_default=""))
        batch.add_column(sa.Column("nutrition", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("product") as batch:
        batch.drop_column("nutrition")
        batch.drop_column("spice_level")
        batch.drop_column("allergens")
