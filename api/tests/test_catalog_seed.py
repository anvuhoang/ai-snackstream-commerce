from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.modules.catalog import seed

from .helpers import ADMIN, PUBLIC


def run_seed(client) -> dict:
    with client.app.state.session_factory() as db:
        return seed.seed_catalog(db)


def test_seed_creates_a_published_labelled_demo_catalog(client, anon):
    created = run_seed(client)
    assert created == {"categories": len(seed.CATEGORIES), "products": len(seed.PRODUCTS)}

    page = anon.get(f"{PUBLIC}/products", params={"pageSize": 48}).json()
    assert page["total"] == len(seed.PRODUCTS)
    assert all(item["isDemo"] for item in page["items"])
    assert {c["name"] for c in anon.get(f"{PUBLIC}/categories").json()} == set(seed.CATEGORIES)
    # a real search over the seeded text
    assert [p["name"] for p in anon.get(f"{PUBLIC}/products", params={"q": "banh trang"}).json()["items"]]


def test_seed_is_idempotent_and_never_overwrites_edits(client, signed_in):
    run_seed(client)
    assert run_seed(client) == {"categories": 0, "products": 0}

    row = signed_in.get(f"{ADMIN}/products", params={"q": "Khô bò"}).json()["items"][0]
    signed_in.patch(f"{ADMIN}/products/{row['id']}", json={"description": "Đã chỉnh sửa bởi nhân viên"})
    run_seed(client)
    assert (
        signed_in.get(f"{ADMIN}/products/{row['id']}").json()["description"] == "Đã chỉnh sửa bởi nhân viên"
    )


def test_seed_data_is_internally_valid():
    skus = [sku for *_, variants in seed.PRODUCTS for sku, *_ in variants]
    assert len(skus) == len(set(skus)), "SKUs must be unique"
    for name, category, *_ in seed.PRODUCTS:
        assert category in seed.CATEGORIES, name
    for *_, variants in seed.PRODUCTS:
        for _sku, _name, price, was, _grams in variants:
            assert was is None or was > price


def test_the_catalog_can_be_seeded_at_start_up(settings: Settings):
    on = settings.model_copy(update={"seed_demo_catalog": True})
    with TestClient(create_app(on)) as c:
        assert c.get(f"{PUBLIC}/products").json()["total"] == len(seed.PRODUCTS)


def test_the_chatbot_index_is_built_at_start_up_only_when_rag_is_on(settings: Settings):
    from sqlalchemy import func, select

    from app.modules.rag.models import KbChunk

    def chunks(config: Settings) -> int:
        app = create_app(config)
        with TestClient(app), app.state.session_factory() as db:
            return db.scalar(select(func.count()).select_from(KbChunk))

    base = settings.model_copy(update={"seed_demo_catalog": True})
    assert chunks(base.model_copy(update={"chat_rag_enabled": False})) == 0
    assert chunks(base.model_copy(update={"chat_rag_enabled": True, "rag_embedder": "hash"})) > 0
