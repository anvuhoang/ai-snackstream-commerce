"""Small admin CLI.

python -m app.cli migrate
python -m app.cli seed-catalog                              # labelled demo products (idempotent)
python -m app.cli expire-orders                             # cancel unpaid online orders whose time ran out
python -m app.cli create-admin you@example.com            # prompts for the password
python -m app.cli create-admin you@example.com --role staff
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

from app.core.config import get_settings
from app.core.db import make_engine, make_session_factory
from app.main import run_migrations
from app.modules.auth import service as auth_service
from app.modules.catalog import seed as catalog_seed
from app.modules.orders import service as orders_service


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply database migrations")
    sub.add_parser("seed-catalog", help="create the labelled demo catalog (idempotent)")
    sub.add_parser(
        "expire-orders",
        help="cancel unpaid online orders whose payment time ran out (run every minute or so)",
    )
    admin = sub.add_parser("create-admin", help="create a back-office user")
    admin.add_argument("email")
    admin.add_argument("--role", choices=["admin", "staff"], default="admin")
    args = parser.parse_args(argv)

    settings = get_settings()
    if args.cmd == "migrate":
        run_migrations(settings.database_url)
        print("migrations applied")
        return 0

    if args.cmd == "seed-catalog":
        run_migrations(settings.database_url)
        with make_session_factory(make_engine(settings.database_url))() as db:
            print(catalog_seed.seed_catalog(db, Path(settings.media_dir)))
        return 0

    if args.cmd == "expire-orders":
        with make_session_factory(make_engine(settings.database_url))() as db:
            print({"expired": orders_service.expire_due_orders(db)})
        return 0

    password = getpass.getpass("Password: ")
    if len(password) < 10:
        print("Use at least 10 characters.", file=sys.stderr)
        return 1
    run_migrations(settings.database_url)
    with make_session_factory(make_engine(settings.database_url))() as db:
        auth_service.create_admin(db, args.email, password, args.role)
    print(f"created {args.role} {args.email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
