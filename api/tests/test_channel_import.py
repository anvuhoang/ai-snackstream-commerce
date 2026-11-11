"""Numbers other channels report: CSV import, manual entry, duplicate protection, the Shopee and AI tabs, and export."""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from .test_analytics import send
from .test_orders import sellable

A = "/api/admin/analytics"
TODAY = date.today()
D1, D2 = (TODAY - timedelta(days=2)).isoformat(), (TODAY - timedelta(days=1)).isoformat()


def upload(client: TestClient, text: str, name: str = "report.csv", demo: bool = False):
    return client.post(
        f"{A}/imports",
        files={"file": (name, text.encode("utf-8"), "text/csv")},
        data={"isDemo": "true" if demo else "false"},
    )


def channel_rows(client: TestClient, **params) -> dict[str, dict]:
    r = client.get(f"{A}/channels", params=params)
    assert r.status_code == 200, r.text
    return {row["channel"]: row for row in r.json()["rows"]}


GOOD = f"date,channel,content,views,clicks,orders,revenue,cost\n{D1},TikTok,clip-01,1200,90,6,540000,200000\n{D2},tiktok,clip-01,800,40,3,270000,100000\n"


# ================================================================== importing
def test_a_csv_is_imported_and_shown_per_channel(signed_in):
    r = upload(signed_in, GOOD)
    assert r.status_code == 201, r.text
    b = r.json()
    assert (b["kind"], b["rowsTotal"], b["valuesImported"], b["valuesSkipped"]) == ("csv", 2, 12, 0)
    row = channel_rows(signed_in)["tiktok"]  # "TikTok" and "tiktok" are one channel
    assert (row["views"], row["clicks"], row["orders"], row["revenueVnd"], row["costVnd"], row["days"]) == (
        2000,
        130,
        9,
        810_000,
        300_000,
        2,
    )
    assert row["ctr"] == 130 / 2000 and row["ctrNote"] == "ok"
    assert row["costPerOrderVnd"] == round(300_000 / 9) and row["costPerOrderNote"] == "ok"


def test_an_empty_cell_means_not_reported_and_is_never_stored_as_zero(signed_in):
    assert upload(signed_in, f"date,channel,views,clicks\n{D1},facebook,500,\n").status_code == 201
    row = channel_rows(signed_in)["facebook"]
    assert row["views"] == 500 and row["clicks"] is None and row["orders"] is None  # not 0
    assert row["ctr"] is None and row["ctrNote"] == "no_data"


def test_the_same_file_cannot_be_imported_twice(signed_in):
    assert upload(signed_in, GOOD).status_code == 201
    again = upload(signed_in, GOOD, name="renamed.csv")  # a new name does not make it a new file
    assert again.status_code == 409 and again.json()["error"]["code"] == "import_duplicate"
    assert channel_rows(signed_in)["tiktok"]["views"] == 2000  # nothing was added


def test_a_value_already_stored_is_skipped_and_never_overwritten(signed_in):
    upload(signed_in, f"date,channel,content,views\n{D1},tiktok,clip-01,1000\n")
    r = upload(signed_in, f"date,channel,content,views,clicks\n{D1},tiktok,clip-01,9999,50\n")
    assert r.status_code == 201
    assert (r.json()["valuesImported"], r.json()["valuesSkipped"]) == (
        1,
        1,
    )  # the clicks are new, the views are a repeat
    row = channel_rows(signed_in)["tiktok"]
    assert row["views"] == 1000 and row["clicks"] == 50


def test_one_bad_row_refuses_the_whole_file(signed_in):
    text = f"date,channel,views\n{D1},tiktok,100\nnot-a-date,tiktok,5\n{D2},,7\n{D2},tiktok,-3\n"
    r = upload(signed_in, text)
    assert r.status_code == 422 and r.json()["error"]["code"] == "csv_invalid_rows"
    details = r.json()["error"]["details"]
    assert details["total"] == 3 and [p["line"] for p in details["problems"]] == [3, 4, 5]
    assert channel_rows(signed_in) == {}  # not even the good row went in


def test_thousand_separators_dong_signs_and_dd_mm_yyyy_are_understood(signed_in):
    day = (TODAY - timedelta(days=3)).strftime("%d/%m/%Y")
    r = upload(signed_in, f"date;channel;revenue;cost\n{day};Shopee;1.250.000đ;300,000\n")
    assert r.status_code == 201, r.text
    row = channel_rows(signed_in)["shopee"]
    assert (row["revenueVnd"], row["costVnd"]) == (1_250_000, 300_000)


def test_vietnamese_column_names_are_accepted(signed_in):
    r = upload(signed_in, f"Ngày;Kênh;Lượt xem;Chi phí\n{D1};Facebook;300;50000\n")
    assert r.status_code == 201, r.text
    assert channel_rows(signed_in)["facebook"]["views"] == 300


def test_the_columns_must_be_named(signed_in):
    no_channel = upload(signed_in, "date,views\n2026-11-02,5\n")
    no_numbers = upload(signed_in, "date,channel\n2026-11-02,tiktok\n")
    assert no_channel.status_code == 422 and no_channel.json()["error"]["code"] == "csv_columns"
    assert no_numbers.status_code == 422 and no_numbers.json()["error"]["code"] == "csv_columns"
    assert upload(signed_in, "").status_code == 422


def test_a_header_with_no_data_is_refused(signed_in):
    r = upload(signed_in, "date,channel,views\n")
    assert r.status_code == 422 and r.json()["error"]["code"] == "csv_empty"


# ================================================================== the formulas
def test_a_ratio_uses_only_the_days_that_report_both_numbers(signed_in):
    # day 1 reports views and clicks; day 2 reports only views. CTR must be 10 / 100, not 10 / 200.
    upload(signed_in, f"date,channel,views,clicks\n{D1},tiktok,100,10\n{D2},tiktok,100,\n")
    row = channel_rows(signed_in)["tiktok"]
    assert row["views"] == 200 and row["clicks"] == 10
    assert row["ctr"] == 0.1


def test_a_zero_denominator_is_cannot_compute_not_a_number(signed_in):
    upload(signed_in, f"date,channel,views,clicks,orders,cost\n{D1},tiktok,0,5,0,100000\n")
    row = channel_rows(signed_in)["tiktok"]
    assert row["ctr"] is None and row["ctrNote"] == "no_denominator"
    assert row["costPerOrderVnd"] is None and row["costPerOrderNote"] == "no_denominator"


def test_the_period_and_channel_filters_apply(signed_in):
    upload(signed_in, f"date,channel,views\n{D1},tiktok,100\n{D2},facebook,50\n")
    assert set(channel_rows(signed_in)) == {"tiktok", "facebook"}
    assert set(channel_rows(signed_in, channel="tiktok")) == {"tiktok"}
    assert channel_rows(signed_in, **{"from": D2, "to": D2}).keys() == {"facebook"}
    assert signed_in.get(f"{A}/channels", params={"from": D2, "to": D1}).status_code == 422


def test_demo_numbers_are_left_out_unless_asked(signed_in):
    assert upload(signed_in, f"date,channel,views\n{D1},tiktok,100\n", demo=True).status_code == 201
    assert channel_rows(signed_in) == {}
    assert channel_rows(signed_in, demo="include")["tiktok"]["views"] == 100
    assert channel_rows(signed_in, demo="only")["tiktok"]["views"] == 100
    # a real value for the same key is a different row from the demo one
    assert upload(signed_in, f"date,channel,views\n{D1},tiktok,7\n").status_code == 201
    assert channel_rows(signed_in)["tiktok"]["views"] == 7


# ================================================================== manual entry and undo
def test_a_number_can_be_typed_in_and_the_same_entry_is_refused_twice(signed_in):
    entry = {"day": D1, "channel": "TikTok", "contentCode": "clip-02", "views": 700, "clicks": 35}
    first = signed_in.post(f"{A}/manual", json=entry)
    assert (
        first.status_code == 201 and first.json()["kind"] == "manual" and first.json()["valuesImported"] == 2
    )
    assert channel_rows(signed_in)["tiktok"]["views"] == 700
    again = signed_in.post(f"{A}/manual", json=entry)
    assert again.status_code == 409 and again.json()["error"]["code"] == "import_duplicate"


def test_a_manual_entry_needs_at_least_one_number_and_a_sane_channel(signed_in):
    assert signed_in.post(f"{A}/manual", json={"day": D1, "channel": "tiktok"}).status_code == 422
    assert signed_in.post(f"{A}/manual", json={"day": D1, "channel": "!!", "views": 5}).status_code == 422
    assert (
        signed_in.post(f"{A}/manual", json={"day": D1, "channel": "tiktok", "views": -5}).status_code == 422
    )


def test_an_import_can_be_undone_by_an_admin_and_then_added_again(signed_in, staff):
    batch = upload(signed_in, GOOD).json()
    listed = signed_in.get(f"{A}/imports").json()
    assert listed[0]["id"] == batch["id"] and listed[0]["createdByEmail"]
    assert staff.delete(f"{A}/imports/{batch['id']}").status_code == 403  # undoing is for admins
    assert signed_in.delete(f"{A}/imports/{batch['id']}").status_code == 204
    assert channel_rows(signed_in) == {}
    assert upload(signed_in, GOOD).status_code == 201  # the file may be imported again after the undo
    assert signed_in.delete(f"{A}/imports/99999").status_code == 404


def test_staff_may_add_numbers_but_a_visitor_may_not(anon, staff):
    assert upload(staff, f"date,channel,views\n{D1},tiktok,5\n").status_code == 201
    assert anon.get(f"{A}/channels").status_code == 401
    assert anon.post(f"{A}/manual", json={"day": D1, "channel": "x", "views": 1}).status_code == 401


# ================================================================== Shopee and AI
def test_the_shopee_tab_keeps_web_clicks_and_shopee_reports_apart(signed_in, anon):
    p = sellable(signed_in)
    send(anon, "shopee_click", 1, sku=p["variants"][0]["sku"])
    send(anon, "shopee_click", 2, sku=p["variants"][0]["sku"])
    empty = signed_in.get(f"{A}/shopee").json()
    assert empty["webClicks"] == 2 and empty["reported"] is None  # nothing imported yet
    upload(signed_in, f"date,channel,orders,revenue\n{D1},shopee,4,380000\n")
    data = signed_in.get(f"{A}/shopee").json()
    assert data["webClicks"] == 2
    assert (data["reported"]["orders"], data["reported"]["revenueVnd"]) == (4, 380_000)
    web = signed_in.get(f"{A}/overview").json()["totals"]
    assert web["ordersCreated"] == 0  # Shopee's orders are never added to the web's own


def test_the_ai_tab_says_nothing_was_collected_until_chat_or_live_send_events(signed_in, anon):
    first = signed_in.get(f"{A}/ai").json()
    assert first["collected"] is False and first["chatQuestions"] == 0
    send(anon, "chat_question", 1, conversationId="conv-0001")
    send(anon, "chat_question", 1, conversationId="conv-0001")
    send(anon, "chat_question", 2, conversationId="conv-0002")
    send(anon, "live_join", 3, liveId="live-0001")
    data = signed_in.get(f"{A}/ai").json()
    assert data["collected"] is True
    assert (data["chatQuestions"], data["chatSessions"], data["liveJoins"], data["liveProductClicks"]) == (
        3,
        2,
        1,
        0,
    )


# ================================================================== export
def test_the_channel_numbers_can_be_exported_in_the_format_the_importer_reads(signed_in):
    upload(signed_in, GOOD)
    r = signed_in.get(f"{A}/export/channels.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"] and ".csv" in r.headers["content-disposition"]
    lines = r.content.decode("utf-8-sig").strip().splitlines()
    assert lines[0] == "date,channel,content,metric,value,demo,batch" and len(lines) == 1 + 12
    assert f"{D1},tiktok,clip-01,views,1200,no," in "\n".join(lines)


def test_the_overview_can_be_exported_and_empty_cells_mean_cannot_compute(signed_in):
    r = signed_in.get(f"{A}/export/overview.csv")
    assert r.status_code == 200
    lines = r.content.decode("utf-8-sig").strip().splitlines()
    assert lines[0].startswith("section,name") and lines[1].startswith(
        "funnel,product_view,sessions,0,,first_step"
    )


def test_the_exports_need_a_signed_in_user(anon):
    assert anon.get(f"{A}/export/channels.csv").status_code == 401
    assert anon.get(f"{A}/export/overview.csv").status_code == 401
