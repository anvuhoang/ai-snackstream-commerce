"""Data management: CSV/Excel import, manual entry, demo data, report export, Make.com webhook."""
from __future__ import annotations

import csv
import io
import json
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import analytics as A
from .. import config, ingest, schemas as S, seed
from ..db import get_db
from ..deps import admin, get_f, require_csrf
from ..metrics import METRIC_KEYS
from ..models import Content, ImportBatch, Order, OrderAttribution
from .analytics import _source

router = APIRouter(prefix="/api", tags=["data"])
MAX_UPLOAD = 5 * 1024 * 1024


@router.get("/data/overview", dependencies=[Depends(admin)])
def data_overview(db: Session = Depends(get_db)):
    all_f = A.Filters.from_params({"from": "2000-01-01", "to": "2100-01-01"})
    rows = A.build_rows(db, all_f)
    batches = list(db.scalars(select(ImportBatch).order_by(ImportBatch.id.desc()).limit(15)))
    return {
        "sources": [_source(s) for s in A.source_status(db)],
        "coverage": [{"platform": g["platform"], "kind": g["kind"], "n": g["n"], "cells": g["cells"]} for g in A.coverage_matrix(rows)],
        "batches": [{"id": b.id, "kind": b.kind, "filename": b.filename, "method": b.method, "isDemo": b.is_demo, "rowsOk": b.rows_ok,
                     "rowsErr": b.rows_err, "sourceNote": b.source_note, "createdAt": S.iso(b.created_at)} for b in batches],
        "specs": [{"kind": k, "label": sp["label"], "columns": [{"name": c["name"], "type": c["type"], "required": c["required"], "help": c["help"]}
                                                                for c in sp["columns"]]} for k, sp in ingest.SPECS.items()],
        "contentCodes": [r.c.code for r in rows],
    }


@router.post("/data/import", dependencies=[Depends(admin), Depends(require_csrf)])
async def data_import(kind: str = Form(...), file: UploadFile = File(...), is_demo: bool = Form(False), strict: bool = Form(True),
                      source_note: str = Form(""), db: Session = Depends(get_db)):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File quá lớn (tối đa 5 MB).")
    res = ingest.import_file(db, kind, file.filename or "upload", data, is_demo=is_demo, strict=strict, source_note=source_note.strip())
    return {"kind": kind, "file": file.filename, "ok": res.ok, "errors": res.errors[:50], "nErrors": len(res.errors), "warnings": res.warnings,
            "message": res.message, "duplicate": res.duplicate, "rejected": res.rejected, "batchId": res.batch_id}


class Manual(BaseModel):
    contentCode: str
    day: str
    metricKey: str
    value: str = ""
    sourceNote: str


@router.post("/data/manual", dependencies=[Depends(admin), Depends(require_csrf)])
def data_manual(body: Manual, db: Session = Depends(get_db)):
    if not body.sourceNote.strip():
        raise HTTPException(400, "Nhập tay phải ghi rõ nguồn số liệu.")
    if body.metricKey not in METRIC_KEYS:
        raise HTTPException(400, "Chỉ số không hợp lệ.")
    is_demo = bool(db.scalar(select(Content.is_demo).where(Content.code == body.contentCode)))
    res = ingest.import_rows(db, "metrics", [{"content_code": body.contentCode.strip(), "date": body.day, body.metricKey: body.value.strip() or "NA"}],
                             method="manual", source_note=body.sourceNote.strip(), is_demo=is_demo)
    if not res.ok:
        raise HTTPException(422, res.message or "; ".join(e["message"] for e in res.errors))
    return {"ok": True, "message": f"Đã lưu {METRIC_KEYS[body.metricKey]} cho {body.contentCode} ngày {body.day}."}


@router.post("/data/seed", dependencies=[Depends(admin), Depends(require_csrf)])
def data_seed(db: Session = Depends(get_db)):
    created = seed.seed_demo(db)
    return {"ok": created, "message": "Đã nạp dữ liệu demo (có nhãn DEMO)." if created else "Dữ liệu demo đã có sẵn. Xóa demo trước nếu muốn nạp lại."}


@router.post("/data/clear-demo", dependencies=[Depends(admin), Depends(require_csrf)])
def data_clear(db: Session = Depends(get_db)):
    n = seed.clear_demo(db)
    return {"ok": True, "message": f"Đã xóa dữ liệu demo ({n} bản ghi). Dữ liệu thật được giữ nguyên."}


@router.get("/data/template/{kind}.csv", dependencies=[Depends(admin)])
def data_template(kind: str):
    if kind not in ingest.SPECS:
        raise HTTPException(404, "Không có mẫu")
    return Response(ingest.template_csv(kind), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="mau_{kind}.csv"'})


@router.get("/data/batch/{batch_id}/errors.csv", dependencies=[Depends(admin)])
def batch_errors(batch_id: int, db: Session = Depends(get_db)):
    b = db.get(ImportBatch, batch_id)
    if not b:
        raise HTTPException(404, "Không tìm thấy")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["dong", "loi"])
    for e in json.loads(b.errors_json or "[]"):
        w.writerow([e["row"], e["message"]])
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="loi_lo_{batch_id}.csv"'})


@router.post("/ingest/make")
async def ingest_make(request: Request, db: Session = Depends(get_db)):
    """Make.com webhook: {"kind": "metrics", "rows": [...], "source_note": "..."}. Requires the X-Ingest-Token header."""
    token = request.headers.get("x-ingest-token", "")
    if not config.INGEST_TOKEN or not secrets.compare_digest(token, config.INGEST_TOKEN):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.json()
    kind = body.get("kind", "")
    if kind not in ingest.SPECS:
        return JSONResponse({"error": "kind không hợp lệ"}, status_code=400)
    res = ingest.import_rows(db, kind, [{str(k).lower(): v for k, v in r.items()} for r in body.get("rows", [])], method="api",
                             source_note=str(body.get("source_note", "Make.com webhook")), strict=True)
    return JSONResponse({"ok": res.ok, "errors": res.errors[:50], "message": res.message}, status_code=200 if res.ok else 422)


@router.get("/export/{name}.csv", dependencies=[Depends(admin)])
def export(name: str, db: Session = Depends(get_db), f: A.Filters = Depends(get_f)):
    rows = A.build_rows(db, f)
    buf = io.StringIO()
    w = csv.writer(buf)
    na = lambda a: a.label if a.value is None else a.value  # noqa: E731
    nr = lambda r: "không tính được" if r.value is None else round(r.value, 4)  # noqa: E731
    if name == "noi_dung":
        w.writerow(["ma", "nen_tang", "loai", "tieu_de", "phan_phoi", "dich", "chien_dich", "sku", "nhom_ai", "muc_xac_dinh", "luot_xem", "hien_thi",
                    "tuong_tac", "click", "don", "co_so_don", "doanh_thu", "chi_phi", "click_tren_xem_%", "don_tren_click_%", "don_tren_1000_xem", "roas",
                    "chi_phi_tren_don", "du_lieu_demo"])
        for r in rows:
            w.writerow([r.c.code, r.c.platform, r.c.kind, r.c.title, r.c.distribution, r.c.destination, r.c.campaign, r.c.sku, r.c.ai_group,
                        r.c.attribution_level, na(r.agg("views")), na(r.agg("impressions")), na(r.agg("engagements")), na(r.clicks), na(r.orders),
                        r.orders.basis or "", na(r.revenue), na(r.total_cost), nr(r.r_click_per_view()), nr(r.r_order_per_click()),
                        nr(r.r_orders_per_1000()), nr(r.r_roas()), nr(r.r_cost_per_order()), "co" if r.c.is_demo else "khong"])
    elif name == "nen_tang":
        w.writerow(["nen_tang", "so_noi_dung", "luot_xem", "hien_thi", "click", "don", "doanh_thu", "chi_phi", "click_tren_xem_%", "don_tren_click_%", "chi_phi_tren_don"])
        for p, label in config.PLATFORMS.items():
            rs = [r for r in rows if r.c.platform == p]
            if not rs:
                continue
            s = A.summarize(rs)
            w.writerow([label, len(rs), na(s["views"]), na(s["impressions"]), na(s["clicks"]), na(s["orders"]), na(s["revenue"]), na(s["cost"]),
                        nr(s["click_per_view"]), nr(s["order_per_click"]), nr(s["cost_per_order"])])
    elif name == "don_hang":
        w.writerow(["ma_don", "ngay", "trang_thai", "doanh_thu", "sku", "khach_moi", "noi_dung", "cach_xac_dinh", "du_lieu_demo"])
        q = select(Order, OrderAttribution).outerjoin(OrderAttribution, OrderAttribution.order_id == Order.order_id).where(
            Order.order_date >= f.date_from, Order.order_date <= f.date_to).order_by(Order.order_date)
        for o, a in db.execute(q):
            if (f.mode == "demo" and not o.is_demo) or (f.mode == "real" and o.is_demo) or (f.sku and o.sku != f.sku):
                continue
            w.writerow([o.order_id, o.order_date, o.status, o.revenue, o.sku, "" if o.is_new_customer is None else o.is_new_customer,
                        a.content_code if a else "", a.method if a else "", "co" if o.is_demo else "khong"])
    else:
        return PlainTextResponse("Không có báo cáo này", status_code=404)
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{name}_{f.date_from}_{f.date_to}.csv"'})
