"""Write the API's OpenAPI document to a file; the web app generates its TypeScript types from it.

python -m app.export_openapi openapi.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.core.config import Settings
from app.main import create_app


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "openapi.json")
    # An in-memory SQLite URL: exporting the schema must not need a real database.
    app = create_app(Settings(DATABASE_URL="sqlite://", RUN_MIGRATIONS_ON_START=False))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
