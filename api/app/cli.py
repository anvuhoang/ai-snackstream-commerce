"""Small admin CLI.

python -m app.cli migrate
python -m app.cli seed-catalog                              # labelled demo products (idempotent)
python -m app.cli sync-odoo                                 # copy on-hand counts from Odoo (needs ODOO_* settings)
python -m app.cli expire-orders                             # cancel unpaid online orders whose time ran out
python -m app.cli import-product-facts docs/product-data-to-collect.csv   # allergens, spice, nutrition, Shopee link
python -m app.cli reindex-kb                                # (re)build the passages the chatbot searches
python -m app.cli eval-rag [--questions eval/rag_questions.json]   # measure retrieval (hit@k, MRR)
python -m app.cli create-admin you@example.com            # prompts for the password
python -m app.cli create-admin you@example.com --role staff
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from pathlib import Path

from app.core.config import get_settings
from app.core.db import make_engine, make_session_factory
from app.main import run_migrations
from app.modules.auth import service as auth_service
from app.modules.catalog import facts_import
from app.modules.catalog import seed as catalog_seed
from app.modules.inventory import sync as inventory_sync
from app.modules.orders import service as orders_service
from app.modules.rag import evaluate as rag_evaluate
from app.modules.rag import index as rag_index
from app.modules.rag.embedder import make_embedder


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate", help="apply database migrations")
    sub.add_parser("seed-catalog", help="create the labelled demo catalog (idempotent)")
    sub.add_parser(
        "expire-orders",
        help="cancel unpaid online orders whose payment time ran out (run every minute or so)",
    )
    sub.add_parser(
        "sync-odoo", help="copy on-hand stock counts from Odoo, matched on SKU (run every few minutes)"
    )
    sub.add_parser(
        "reindex-kb", help="rebuild the chatbot's searchable passages from products, FAQs and policy files"
    )
    facts = sub.add_parser(
        "import-product-facts",
        help="fill allergens, spice level, nutrition and Shopee links from the completed CSV",
    )
    facts.add_argument("csv_path")
    ev = sub.add_parser("eval-rag", help="measure how often retrieval finds the right passage")
    ev.add_argument("--questions", default="eval/rag_questions.json")
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

    if args.cmd == "sync-odoo":
        if not settings.odoo_enabled:
            print("Odoo is not configured: set ODOO_URL, ODOO_DB and ODOO_API_KEY", file=sys.stderr)
            return 1
        with make_session_factory(make_engine(settings.database_url))() as db:
            run = inventory_sync.sync_from_odoo(db, settings)
            print(
                {
                    "ok": run.ok,
                    "matched": run.matched,
                    "changed": run.changed,
                    "missing": run.missing_skus,
                    "error": run.error,
                }
            )
        return 0 if run.ok else 1

    if args.cmd == "expire-orders":
        with make_session_factory(make_engine(settings.database_url))() as db:
            print({"expired": orders_service.expire_due_orders(db)})
        return 0

    if args.cmd == "import-product-facts":
        with make_session_factory(make_engine(settings.database_url))() as db:
            print(facts_import.import_facts(db, facts_import.read_rows(Path(args.csv_path))))
        return 0

    if args.cmd in ("reindex-kb", "eval-rag"):
        embedder = make_embedder(settings)
        with make_session_factory(make_engine(settings.database_url))() as db:
            if args.cmd == "reindex-kb":
                print({"embedder": embedder.name, **rag_index.reindex(db, embedder)})
                return 0
            questions = json.loads(Path(args.questions).read_text(encoding="utf-8"))
            report = rag_evaluate.evaluate(db, embedder, questions)
            print(json.dumps(report, ensure_ascii=False, indent=1))
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
