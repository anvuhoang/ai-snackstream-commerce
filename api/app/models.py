"""Imports every module's ORM models so they register on Base.metadata (Alembic autogenerate reads this).

When a module gets its first model, add one import line here.
"""

from app.modules.auth import models as _auth  # noqa: F401
from app.modules.catalog import models as _catalog  # noqa: F401
