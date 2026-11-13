"""Imports every module's ORM models so they register on Base.metadata (Alembic autogenerate reads this).

When a module gets its first model, add one import line here.
"""

from app.modules.analytics import models as _analytics  # noqa: F401
from app.modules.auth import models as _auth  # noqa: F401
from app.modules.catalog import models as _catalog  # noqa: F401
from app.modules.chat import models as _chat  # noqa: F401
from app.modules.inventory import models as _inventory  # noqa: F401
from app.modules.orders import models as _orders  # noqa: F401
