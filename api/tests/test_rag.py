"""Retrieval for the chatbot: passages, the index, search, live price and stock, the evaluator, and the chat wiring."""

from __future__ import annotations

import io
import json
import math
from unittest.mock import patch

import pytest

from app.modules.chat import router as chat_router
from app.modules.chat import service as chat_service
from app.modules.chat.models import FAQ
from app.modules.rag import chunker, evaluate, index, live_facts, retriever
from app.modules.rag import service as rag_service
from app.modules.rag.embedder import HashingEmbedder
from app.modules.rag.models import KbChunk

from .helpers import make_product

EMB = HashingEmbedder()


@pytest.fixture(autouse=True)
def no_policy_files(tmp_path, monkeypatch):
    """The shop's real policy files would add passages to every count below; these tests start with none."""
    empty = tmp_path / "knowledge"
    empty.mkdir()
    monkeypatch.setattr(chunker, "KNOWLEDGE_DIR", empty)


def db_of(client):
    return client.app.state.session_factory()


def two_products(admin):
    a = make_product(
        admin,
        publish=True,
        name="Khô gà lá chanh",
        description="Giòn rụm, thơm lá chanh.",
        ingredients="Ức gà, lá chanh Thái, ớt xiêm xanh",
        storage="6 tháng. Đậy kín, để nơi khô ráo",
        variants=[{"sku": "KG-1", "name": "Gói 250g", "priceVnd": 55000, "weightG": 250}],
    )
    b = make_product(
        admin,
        publish=True,
        name="Bánh tráng muối hành",
        description="Dẻo mềm, thơm hành.",
        ingredients="Bánh tráng, muối, hành phi, dầu thực vật",
        storage="30 ngày. Đóng kín sau khi mở",
        variants=[{"sku": "BT-1", "name": "Gói 100g", "priceVnd": 25000}],
    )
    return a, b


# ================================================================== embedder
def test_the_hashing_embedder_is_deterministic_unit_length_and_ignores_accents():
    a, b = EMB.embed(["Bánh tráng muối hành", "banh trang muoi hanh"])
    assert math.isclose(math.sqrt(sum(x * x for x in a)), 1.0, rel_tol=1e-9)
    assert EMB.embed(["Bánh tráng muối hành"])[0] == a
    unrelated = EMB.embed(["khô gà lá chanh"])[0]
    assert sum(x * y for x, y in zip(a, b, strict=True)) > sum(
        x * y for x, y in zip(a, unrelated, strict=True)
    )


# ================================================================== passages
def test_a_published_product_gives_three_passages_and_none_of_them_holds_the_price(signed_in):
    two_products(signed_in)
    make_product(signed_in, name="Món nháp")  # a draft is not for customers
    with db_of(signed_in) as db:
        chunks = chunker.build_chunks(db)
    kinds = sorted((c.sku, c.kind) for c in chunks)
    assert kinds == [
        ("BT-1", "ingredients"),
        ("BT-1", "overview"),
        ("BT-1", "storage"),
        ("KG-1", "ingredients"),
        ("KG-1", "overview"),
        ("KG-1", "storage"),
    ]
    assert not any("55000" in c.text or "55.000" in c.text for c in chunks)  # price and stock are read live
    assert "250 g" in next(c for c in chunks if c.sku == "KG-1" and c.kind == "overview").text


def test_only_approved_faqs_become_passages(signed_in):
    with db_of(signed_in) as db:
        db.add_all(
            [
                FAQ(question="Phí giao hàng?", answer="Miễn phí từ 300.000đ.", approved=True),
                FAQ(question="Nháp?", answer="Chưa duyệt.", approved=False),
            ]
        )
        db.commit()
        faqs = [c for c in chunker.build_chunks(db) if c.source_type == "faq"]
    assert len(faqs) == 1 and "300.000" in faqs[0].text


def test_policy_files_are_split_into_paragraphs(tmp_path):
    (tmp_path / "giao-hang.md").write_text("Giao trong 2 ngày.\n\nMiễn phí từ 300.000đ.\n", encoding="utf-8")
    (tmp_path / "ignored.txt").write_text("not markdown", encoding="utf-8")
    chunks = chunker.doc_chunks(tmp_path)
    assert [c.text for c in chunks] == ["Giao trong 2 ngày.", "Miễn phí từ 300.000đ."]


# ================================================================== index
def test_reindexing_only_touches_what_changed(signed_in):
    a, _ = two_products(signed_in)
    with db_of(signed_in) as db:
        assert index.reindex(db, EMB) == {"added": 6, "updated": 0, "removed": 0, "unchanged": 0}
        assert index.reindex(db, EMB) == {"added": 0, "updated": 0, "removed": 0, "unchanged": 6}
    signed_in.patch(f"/api/admin/catalog/products/{a['id']}", json={"storage": "12 tháng. Để trong tủ lạnh"})
    with db_of(signed_in) as db:
        assert index.reindex(db, EMB) == {"added": 0, "updated": 1, "removed": 0, "unchanged": 5}
    signed_in.post(f"/api/admin/catalog/products/{a['id']}/hide")
    with db_of(signed_in) as db:
        stats = index.reindex(db, EMB)
        assert stats["removed"] == 3 and db.query(KbChunk).count() == 3


def test_a_different_embedder_re_embeds_everything(signed_in):
    two_products(signed_in)

    class Other(HashingEmbedder):
        def __init__(self) -> None:
            super().__init__(128)

    with db_of(signed_in) as db:
        index.reindex(db, EMB)
        assert index.reindex(db, Other())["updated"] == 6


# ================================================================== search
def test_a_question_finds_the_passage_that_answers_it(signed_in):
    two_products(signed_in)
    with db_of(signed_in) as db:
        index.reindex(db, EMB)
        top = retriever.retrieve(db, EMB, "Khô gà lá chanh làm từ những gì?", k=3)
        assert (top[0].sku, top[0].kind) == ("KG-1", "ingredients")
        top = retriever.retrieve(db, EMB, "Bánh tráng muối hành để được bao lâu?", k=3)
        assert (top[0].sku, top[0].kind) == ("BT-1", "storage")


def test_the_product_being_viewed_is_preferred(signed_in):
    two_products(signed_in)
    with db_of(signed_in) as db:
        index.reindex(db, EMB)
        top = retriever.retrieve(db, EMB, "bảo quản thế nào?", k=1, sku="BT-1")
        assert top[0].sku == "BT-1"
        assert retriever.retrieve(db, EMB, "   ", k=3) == []


def test_nothing_is_returned_before_anything_is_indexed(signed_in):
    two_products(signed_in)
    with db_of(signed_in) as db:
        assert retriever.retrieve(db, EMB, "khô gà", k=3) == []


# ================================================================== live facts
def test_price_and_stock_come_from_our_tables_at_answer_time(signed_in):
    a, _ = two_products(signed_in)
    settings = signed_in.app.state.settings
    with db_of(signed_in) as db:
        facts = live_facts.facts_for(db, settings, ["KG-1"])
    assert [(f.sku, f.price, f.currency) for f in facts] == [("KG-1", 55000.0, "VND")]
    assert facts[0].product_url.startswith("/products/")
    assert facts[0].image_url is None  # KG-1 has no bundled photo
    variant_id = a["variants"][0]["id"]
    assert (
        signed_in.patch(f"/api/admin/catalog/variants/{variant_id}", json={"priceVnd": 60000}).status_code
        == 200
    )
    with db_of(signed_in) as db:
        assert live_facts.facts_for(db, settings, ["KG-1"])[0].price == 60000.0
        assert live_facts.facts_for(db, settings, []) == []


# ================================================================== evaluation
def test_the_evaluator_reports_hit_rate_and_the_questions_it_missed(signed_in):
    two_products(signed_in)
    questions = [
        {"q": "Khô gà lá chanh làm từ những gì?", "expect": [{"sku": "KG-1", "kind": "ingredients"}]},
        {"q": "Bánh tráng muối hành bảo quản ra sao?", "expect": [{"sku": "BT-1"}]},
        {"q": "Có bán điện thoại không?", "expect": [{"sku": "NOPE-1"}]},  # nothing can answer this
    ]
    with db_of(signed_in) as db:
        index.reindex(db, EMB)
        report = evaluate.evaluate(db, EMB, questions, ks=(1, 3))
    assert report["questions"] == 3 and report["hit@1"] == 0.667 and report["hit@3"] == 0.667
    assert report["mrr"] == 0.667
    assert [m["q"] for m in report["misses"]] == ["Có bán điện thoại không?"]


# ================================================================== chat wiring
def test_with_retrieval_on_the_chatbot_sends_passages_and_live_facts_and_never_reads_odoo(signed_in):
    two_products(signed_in)
    with db_of(signed_in) as db:
        index.reindex(db, EMB)
    chat_router._hits.clear()
    settings = signed_in.app.state.settings
    settings.gemini_api_key, settings.gemini_free_tier_confirmed = "k", True
    settings.chat_rag_enabled = True
    answer = {
        "candidates": [
            {
                "finishReason": "STOP",
                "content": {"parts": [{"text": "Khô gà lá chanh làm từ ức gà và lá chanh."}]},
            }
        ]
    }
    with (
        patch.object(chat_service, "read_products", side_effect=AssertionError("Odoo must not be read")),
        patch.object(
            chat_service.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(answer).encode())
        ) as call,
    ):
        r = signed_in.post("/api/chat/messages", json={"message": "Khô gà lá chanh làm từ những gì?"})
    assert r.status_code == 200, r.text
    prompt = json.loads(call.call_args.args[0].data)["systemInstruction"]["parts"][0]["text"]
    assert "passages" in prompt and "Ức gà, lá chanh Thái" in prompt  # the retrieved passage
    assert "55000" in prompt  # the live price
    assert r.json()["products"][0]["sku"] == "KG-1"


def test_with_retrieval_off_nothing_changes(signed_in):
    chat_router._hits.clear()
    settings = signed_in.app.state.settings
    settings.gemini_api_key, settings.gemini_free_tier_confirmed = "k", True
    assert settings.chat_rag_enabled is False
    with (
        patch.object(rag_service, "build_context", side_effect=AssertionError("retrieval must stay off")),
        patch.object(chat_service, "read_products", return_value=[]),
        patch.object(chat_service.urllib.request, "urlopen", side_effect=OSError),
    ):
        assert signed_in.post("/api/chat/messages", json={"message": "giá?"}).status_code == 503


# ================================================================== no data, no AI call
def _rag_chat(signed_in, message, sku=None):
    two_products(signed_in)
    with db_of(signed_in) as db:
        index.reindex(db, EMB)
    chat_router._hits.clear()
    settings = signed_in.app.state.settings
    settings.gemini_api_key, settings.gemini_free_tier_confirmed = "k", True
    settings.chat_rag_enabled = True
    answer = {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "ok"}]}}]}
    body = {"message": message, **({"sku": sku} if sku else {})}
    with patch.object(
        chat_service.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(answer).encode())
    ) as call:
        r = signed_in.post("/api/chat/messages", json=body)
    return r, call


def test_a_question_that_matches_nothing_gets_the_fixed_reply_and_no_ai_call(signed_in):
    r, call = _rag_chat(signed_in, "thời tiết hôm nay thế nào")
    assert r.status_code == 200, r.text
    assert r.json()["answer"] == chat_service.NO_DATA_ANSWER and r.json()["products"] == []
    call.assert_not_called()  # no tokens spent
    logs = signed_in.get("/api/admin/chat/logs").json()["items"]
    assert logs[0]["outcome"] == "no_data"


def test_the_product_being_viewed_does_not_make_an_off_topic_question_relevant(signed_in):
    r, call = _rag_chat(signed_in, "iphone 15 giá bao nhiêu", sku="KG-1")
    assert r.json()["answer"] == chat_service.NO_DATA_ANSWER
    call.assert_not_called()


def test_a_question_about_a_product_still_goes_to_the_ai_with_the_three_tier_rules(signed_in):
    r, call = _rag_chat(signed_in, "Khô gà lá chanh có glucose không?")
    assert r.json()["answer"] == "ok"
    call.assert_called_once()
    prompt = json.loads(call.call_args.args[0].data)["systemInstruction"]["parts"][0]["text"]
    assert "CÁCH TRẢ LỜI" in prompt


# ================================================================== allergen, spice and nutrition facts
def test_allergen_spice_and_nutrition_text_become_passages_only_when_entered(signed_in):
    a, b = two_products(signed_in)
    r = signed_in.patch(
        f"/api/admin/catalog/products/{a['id']}",
        json={"allergens": "Chứa gluten.", "spiceLevel": "Cay vừa", "nutrition": "450 kcal / 100 g"},
    )
    assert r.status_code == 200, r.text
    assert (r.json()["allergens"], r.json()["spiceLevel"]) == ("Chứa gluten.", "Cay vừa")
    with db_of(signed_in) as db:
        chunks = chunker.build_chunks(db)
    by = {(c.sku, c.kind): c.text for c in chunks}
    assert "Chứa gluten." in by[("KG-1", "allergens")] and "ghi theo nhãn" in by[("KG-1", "allergens")]
    assert "Cay vừa" in by[("KG-1", "nutrition")] and "450 kcal" in by[("KG-1", "nutrition")]
    assert ("BT-1", "allergens") not in by and (
        "BT-1",
        "nutrition",
    ) not in by  # nothing entered, nothing claimed


def test_a_question_about_allergens_finds_the_allergen_passage(signed_in):
    a, _ = two_products(signed_in)
    signed_in.patch(f"/api/admin/catalog/products/{a['id']}", json={"allergens": "Chứa đậu phộng."})
    with db_of(signed_in) as db:
        index.reindex(db, EMB)
        top = retriever.retrieve(db, EMB, "Khô gà lá chanh có gây dị ứng không?", k=1)
    assert (top[0].sku, top[0].kind) == ("KG-1", "allergens")


def test_the_completed_sheet_fills_only_the_cells_that_have_a_value(signed_in):
    from app.modules.catalog import facts_import

    a, b = two_products(signed_in)
    rows = [
        {
            "sku": "KG-1",
            "allergens_from_label": "Chứa gluten.",
            "spice_level_checked": "Cay vừa",
            "energy_kcal_per_100g": "450",
            "sodium_mg_per_100g": "900",
        },
        {"sku": "BT-1", "allergens_from_label": "", "spice_level_checked": ""},  # nothing entered: left alone
        {"sku": "NOPE", "allergens_from_label": "x"},
    ]
    with db_of(signed_in) as db:
        result = facts_import.import_facts(db, rows)
    assert result == {"updated": 1, "unknown_skus": ["NOPE"], "rejected": []}
    got = signed_in.get(f"/api/admin/catalog/products/{a['id']}").json()
    assert (
        got["allergens"] == "Chứa gluten."
        and got["nutrition"] == "Trên 100 g: năng lượng 450 kcal; natri 900 mg."
    )
    assert signed_in.get(f"/api/admin/catalog/products/{b['id']}").json()["allergens"] == ""


def test_a_product_with_a_bundled_photo_gets_its_image_in_the_chat_card(signed_in):
    make_product(
        signed_in,
        publish=True,
        name="Bánh tráng me cay",
        ingredients="Bánh tráng, me",
        storage="30 ngày",
        variants=[{"sku": "BANH-TRANG-ME-01", "name": "Gói", "priceVnd": 20000}],
    )
    with db_of(signed_in) as db:
        facts = live_facts.facts_for(db, signed_in.app.state.settings, ["BANH-TRANG-ME-01"])
    assert facts[0].image_url == "/products/BANH-TRANG-ME-01.jpg"
