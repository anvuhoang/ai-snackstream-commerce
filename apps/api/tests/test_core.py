import os
import sys
import tempfile
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "t.db").replace("\\", "/")

from app import analytics as A  # noqa: E402
from app import ingest  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.metrics import Agg, ratio_over, safe_ratio, sum_aggs  # noqa: E402
from app.models import Order, OrderAttribution  # noqa: E402


@pytest.fixture()
def db():
    init_db()
    from app.db import Base, engine
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as s:
        yield s


D = (date.today() - timedelta(days=2)).isoformat()


def csv_bytes(header, *rows):
    return ("\n".join([",".join(header)] + [",".join(r) for r in rows]) + "\n").encode()


def load_catalog(db):
    res = ingest.import_file(db, "contents", "c.csv", csv_bytes(
        ["code", "platform", "kind", "distribution", "attribution_level", "destination"],
        ["V1", "shopee", "video", "organic", "order", "shopee"],
        ["V2", "shopee", "video", "organic", "order", "shopee"],
        ["T1", "tiktok", "video", "organic", "visit", "website"]))
    assert res.ok == 3, res


# ---------------------------------------------------------------- metrics
def test_zero_denominator_is_not_computable():
    r = safe_ratio(5, 0)
    assert r.value is None and "bằng 0" in r.reason


def test_missing_is_not_zero():
    r = safe_ratio(None, 100)
    assert r.value is None
    items = [(Agg(None, "not_provided"), Agg(100.0))]
    assert ratio_over(items, lambda x: x[0], lambda x: x[1]).value is None


def test_ratio_uses_same_scope_only():
    # content 2 has no clicks => its views must not enter the denominator
    items = [(Agg(50.0), Agg(1000.0)), (Agg(None, "not_collected"), Agg(9000.0))]
    r = ratio_over(items, lambda x: x[0], lambda x: x[1])
    assert r.value == pytest.approx(5.0) and r.n_used == 1 and r.n_total == 2 and r.partial


def test_spec_example_per_1000_views():
    # example from the brief: 1000 views, 50 clicks, 5 orders
    assert safe_ratio(50, 1000).value == 5.0
    assert safe_ratio(5, 50).value == 10.0
    assert safe_ratio(5, 1000).value == 0.5
    assert safe_ratio(50, 1000, 1000).value == 50 and safe_ratio(5, 1000, 1000).value == 5


def test_sum_aggs_all_missing_keeps_status():
    a = sum_aggs([Agg(None, "not_provided"), Agg(None, "not_provided")])
    assert a.value is None and a.status == "not_provided"
    assert sum_aggs([Agg(0.0), Agg(None, "not_collected")]).value == 0.0


# ----------------------------------------------------------------- ingest
def test_duplicate_file_rejected(db):
    load_catalog(db)
    m = csv_bytes(["content_code", "date", "views", "clicks"], ["V1", D, "1000", "50"])
    assert ingest.import_file(db, "metrics", "m.csv", m).ok == 1
    again = ingest.import_file(db, "metrics", "m2.csv", m)
    assert again.duplicate and again.ok == 0


def test_upsert_not_double_counted(db):
    load_catalog(db)
    ingest.import_file(db, "metrics", "a.csv", csv_bytes(["content_code", "date", "views"], ["V1", D, "1000"]))
    ingest.import_file(db, "metrics", "b.csv", csv_bytes(["content_code", "date", "views"], ["V1", D, "1200"]))
    f = A.Filters.from_params({})
    row = [r for r in A.build_rows(db, f) if r.c.code == "V1"][0]
    assert row.agg("views").value == 1200  # updated, not summed to 2200


def test_empty_cell_does_not_overwrite_and_na_is_not_zero(db):
    load_catalog(db)
    ingest.import_file(db, "metrics", "a.csv", csv_bytes(["content_code", "date", "views", "clicks"], ["V1", D, "1000", "40"]))
    ingest.import_file(db, "metrics", "b.csv", csv_bytes(["content_code", "date", "views", "clicks", "product_views"], ["V1", D, "1000", "", "NA"]))
    row = [r for r in A.build_rows(db, A.Filters.from_params({})) if r.c.code == "V1"][0]
    assert row.clicks.value == 40
    pv = row.agg("product_views")
    assert pv.value is None and pv.status == "not_provided"
    assert row.agg("add_to_cart").status == "not_collected"


def test_strict_mode_rejects_whole_file(db):
    load_catalog(db)
    bad = csv_bytes(["content_code", "date", "views"], ["V1", D, "10"], ["NOPE", D, "5"], ["V2", "not-a-date", "7"])
    res = ingest.import_file(db, "metrics", "bad.csv", bad, strict=True)
    assert res.rejected and res.ok == 0 and len(res.errors) == 2
    res2 = ingest.import_file(db, "metrics", "bad2.csv", bad + b"V2," + D.encode() + b",11\n", strict=False)
    assert res2.ok == 2 and len(res2.errors) == 2  # valid rows are imported, invalid rows are still reported
    dup_key = ingest.import_file(db, "metrics", "bad3.csv", csv_bytes(["content_code", "date", "views"], ["V1", D, "1"], ["V1", D, "2"]), strict=False)
    assert dup_key.ok == 1 and "Trùng khóa" in dup_key.errors[0]["message"]


def test_missing_required_column_and_negative(db):
    load_catalog(db)
    assert ingest.import_file(db, "metrics", "x.csv", csv_bytes(["date", "views"], [D, "1"])).rejected
    res = ingest.import_file(db, "metrics", "y.csv", csv_bytes(["content_code", "date", "views"], ["V1", D, "-5"]))
    assert res.errors and "âm" in res.errors[0]["message"]


def test_thousand_separator_rejected(db):
    load_catalog(db)
    res = ingest.import_file(db, "metrics", "z.csv", csv_bytes(["content_code", "date", "views"], ['V1', D, '"1.250,5"']))
    assert res.errors


def test_order_dedupe_and_single_attribution(db):
    load_catalog(db)
    o = csv_bytes(["order_id", "order_date", "status", "revenue", "sku", "content_code", "attribution_method"],
                  ["A1", D, "completed", "80000", "S", "V1", "shopee_report"],
                  ["A2", D, "cancelled", "50000", "S", "V1", "shopee_report"])
    assert ingest.import_file(db, "orders", "o1.csv", o).ok == 2
    # the same order A1 shows up in another report, attributed to content V2 => replaced, not counted twice
    o2 = csv_bytes(["order_id", "order_date", "status", "revenue", "sku", "content_code", "attribution_method"],
                   ["A1", D, "completed", "80000", "S", "V2", "shopee_report"])
    assert ingest.import_file(db, "orders", "o2.csv", o2).ok == 1
    assert db.query(Order).count() == 2 and db.query(OrderAttribution).count() == 2
    f = A.Filters.from_params({})
    rows = A.build_rows(db, f)
    by = {r.c.code: r for r in rows}
    assert by["V1"].orders.value == 0  # A2 was cancelled, A1 moved to V2
    assert by["V2"].orders.value == 1
    t = A.order_totals(db, f, rows)
    assert t.counted == 1 and t.not_counted == 1


def test_website_content_orders_undetermined(db):
    load_catalog(db)
    row = [r for r in A.build_rows(db, A.Filters.from_params({})) if r.c.code == "T1"][0]
    assert row.orders.value is None and row.orders.status == "undetermined"
    assert row.r_orders_per_1000().value is None


def test_order_requires_attribution_method(db):
    load_catalog(db)
    res = ingest.import_file(db, "orders", "o.csv", csv_bytes(["order_id", "order_date", "status", "revenue", "content_code"], ["B1", D, "completed", "1", "V1"]))
    assert res.errors


def test_demo_real_not_mixed(db):
    from app import seed
    seed.seed_demo(db)
    res = ingest.import_file(db, "metrics", "r.csv", csv_bytes(["content_code", "date", "views"], ["SV-001", D, "5"]), is_demo=False)
    assert res.errors and "demo" in res.errors[0]["message"]
    f = A.Filters.from_params({"mode": "real"})
    assert A.build_rows(db, f) == []
    seed.clear_demo(db)
    assert A.build_rows(db, A.Filters.from_params({})) == []


def test_cac_not_computable_without_new_customer_flag(db):
    from app import seed
    seed.seed_demo(db)
    rows = A.build_rows(db, A.Filters.from_params({"content": "SV-001"}))
    assert rows[0].new_customers.value is None
    s = A.summarize(rows)
    assert s["cac"].value is None and s["cost_per_order"].value is not None


def test_funnel_marks_missing_steps(db):
    from app import seed
    seed.seed_demo(db)
    rows = [r for r in A.build_rows(db, A.Filters.from_params({"platform": "shopee"})) if r.c.kind == "video"]
    steps = {s.key: s for s in A.funnel(rows)}
    assert steps["product_views"].agg.value is None and steps["product_views"].agg.status == "not_provided"
    assert steps["add_to_cart"].rate.value is None
    assert steps["orders"].rate.value is None  # the previous step (cart) is missing => do not bridge the gap


def test_alembic_migration_matches_models(tmp_path):
    import importlib

    import sqlalchemy as sa
    from alembic import command
    from alembic.config import Config

    from app import config as cfg
    from app.db import Base

    url = "sqlite:///" + str(tmp_path / "mig.db").replace("\\", "/")
    old = cfg.DATABASE_URL
    cfg.DATABASE_URL = url
    try:
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        ac = Config(os.path.join(root, "alembic.ini"))
        ac.set_main_option("script_location", os.path.join(root, "alembic"))
        import alembic.script  # noqa: F401
        env = importlib.import_module("alembic.config")  # noqa: F841
        # env.py reads the URL at import time => run in a subprocess to be sure the new URL is used
        import subprocess
        out = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                             env={**os.environ, "DATABASE_URL": url})
        assert out.returncode == 0, out.stderr
        tables = set(sa.inspect(sa.create_engine(url)).get_table_names())
        assert set(Base.metadata.tables) <= tables
    finally:
        cfg.DATABASE_URL = old
