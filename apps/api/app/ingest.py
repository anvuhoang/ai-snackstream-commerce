"""Data intake: CSV/Excel/manual entry. Row-by-row validation, duplicate protection, upsert on natural keys."""
from __future__ import annotations

import csv
import hashlib
import io
import json
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config
from .metrics import METRIC_KEYS
from .models import (AiLiveSession, ChatLog, Content, Cost, ImportBatch, MetricFact, Order, OrderAttribution, Product,
                     VideoProduction)

ENUMS = {
    "platform": config.PLATFORMS,
    "content_kind": config.CONTENT_KINDS,
    "distribution": config.DISTRIBUTIONS,
    "destination": config.DESTINATIONS,
    "ai_group": config.AI_GROUPS,
    "attribution_level": config.ATTRIBUTION_LEVELS,
    "order_status": config.ORDER_STATUSES,
    "cost_type": config.COST_TYPES,
    "attribution_method": config.ATTRIBUTION_METHODS,
}


def C(name, typ="str", required=False, help=""):
    return {"name": name, "type": typ, "required": required, "help": help}


SPECS: dict[str, dict] = {
    "contents": {
        "label": "Danh mục nội dung (video, bài, live, quảng cáo)",
        "key": "code",
        "columns": [
            C("code", "str", True, "Mã nội dung duy nhất, vd SV-001"),
            C("platform", "enum:platform", True, "shopee | tiktok | facebook | website"),
            C("kind", "enum:content_kind", True, "video | post | live | ad | shop"),
            C("distribution", "enum:distribution", True, "organic | paid | affiliate"),
            C("title"), C("url"), C("campaign"), C("sku"),
            C("destination", "enum:destination", False, "shopee | website (mặc định shopee)"),
            C("ai_group", "enum:ai_group", False, "ai | human | hybrid (mặc định human)"),
            C("attribution_level", "enum:attribution_level", False, "awareness | click | visit | order"),
            C("experiment"), C("variant"), C("tracking_link"), C("kol"),
            C("commission_rate", "float"), C("published_at", "date"),
        ],
        "example": {"code": "SV-101", "platform": "shopee", "kind": "video", "distribution": "organic", "title": "Bánh tráng trộn - hook 1",
                    "campaign": "SnackFest-11", "sku": "BTT-001", "destination": "shopee", "ai_group": "ai",
                    "attribution_level": "order", "published_at": "2026-10-20"},
    },
    "metrics": {
        "label": "Số liệu theo ngày (lượt xem, click, ...)",
        "key": "content_code+date",
        "columns": [C("content_code", "str", True, "Phải có trong danh mục nội dung"), C("date", "date", True, "YYYY-MM-DD hoặc DD/MM/YYYY")]
        + [C(k, "metric", False, "Số; để trống = chưa có dữ liệu; NA = nguồn không cung cấp; NC = chưa kết nối") for k in METRIC_KEYS],
        "example": {"content_code": "SV-101", "date": "2026-10-30", "views": "1250", "engagements": "48", "clicks": "63",
                    "watch_time_sec": "NA", "product_views": "NA", "add_to_cart": "NA"},
    },
    "orders": {
        "label": "Đơn hàng (mã đơn Shopee là khóa chống trùng)",
        "key": "order_id",
        "columns": [
            C("order_id", "str", True, "Mã đơn Shopee"), C("order_date", "date", True),
            C("status", "enum:order_status", True, "pending | shipping | completed | cancelled | returned"),
            C("revenue", "float", True, "Doanh thu đơn (VND)"), C("sku"),
            C("content_code", "str", False, "Nội dung được quy đơn (để trống = chưa xác định nguồn)"),
            C("attribution_method", "enum:attribution_method", False, "Cách xác định nguồn của đơn"),
            C("window_days", "int", False, "Khoảng thời gian ghi nhận (ngày)"),
            C("is_new_customer", "bool", False, "true | false | để trống nếu nguồn không cho biết"),
        ],
        "example": {"order_id": "2610300001", "order_date": "2026-10-30", "status": "completed", "revenue": "78000", "sku": "BTT-001",
                    "content_code": "SV-101", "attribution_method": "shopee_report", "window_days": "7"},
    },
    "costs": {
        "label": "Chi phí theo nội dung / chiến dịch",
        "key": "content_code+date+cost_type",
        "columns": [C("content_code", "str", True), C("date", "date", True),
                    C("cost_type", "enum:cost_type", True, "spend | commission | production | ai_runtime | other"),
                    C("amount", "float", True, "VND, >= 0")],
        "example": {"content_code": "AD-S01", "date": "2026-10-30", "cost_type": "spend", "amount": "120000"},
    },
    "products": {
        "label": "Sản phẩm / SKU",
        "key": "sku",
        "columns": [C("sku", "str", True), C("name", "str", True), C("price", "float", True), C("flash_price", "float"), C("stock", "int"),
                    C("flavor"), C("spice_level"), C("shelf_life"), C("shopee_url")],
        "example": {"sku": "BTT-001", "name": "Bánh tráng trộn Tây Ninh 250g", "price": "39000", "flash_price": "29000", "stock": "240",
                    "flavor": "Muối tôm, hành phi", "spice_level": "Cay vừa", "shelf_life": "6 tháng", "shopee_url": "https://shopee.vn/..."},
    },
    "ai_live": {
        "label": "Log phiên AI Live (Nguyên)",
        "key": "content_code",
        "columns": [C("content_code", "str", True, "Mã phiên live"), C("duration_min", "float"), C("questions_received", "int"),
                    C("questions_answered", "int"), C("accuracy_pct", "float", False, "0-100, theo kiểm tra mẫu"),
                    C("avg_dispatch_ms", "float"), C("avg_e2e_ms", "float"), C("interventions", "int"),
                    C("interruptions", "int"), C("cost_vnd", "float")],
        "example": {"content_code": "SL-101", "duration_min": "180", "questions_received": "64", "questions_answered": "58",
                   "accuracy_pct": "92", "avg_dispatch_ms": "1200", "avg_e2e_ms": "3100", "interventions": "3", "interruptions": "1", "cost_vnd": "210000"},
    },
    "chat_logs": {
        "label": "Log chatbot (Phong bàn giao)",
        "key": "ts+session_id+question",
        "columns": [C("ts", "datetime", True, "Thời điểm nhận câu hỏi, vd 2026-10-30 14:05:00"), C("session_id", "str", True),
                    C("question", "str", True), C("intent", "str", False, "vd INTENT_PRODUCT_INFO"), C("sku"),
                    C("latency_ms", "float", False, "Từ lúc nhận câu hỏi đến lúc trả lời"),
                    C("handoff", "bool", False, "true nếu chuyển người vận hành"), C("clicked_buy", "bool"),
                    C("cost_vnd", "float"), C("correct", "bool", False, "Kết quả kiểm tra thủ công; để trống nếu chưa kiểm")],
        "example": {"ts": "2026-10-30 14:05:00", "session_id": "abc123", "question": "Bánh này cay không?", "intent": "INTENT_PRODUCT_INFO",
                    "sku": "BTT-001", "latency_ms": "2100", "handoff": "false", "clicked_buy": "false", "cost_vnd": "80", "correct": "true"},
    },
    "video_production": {
        "label": "Sản xuất video (Phong)",
        "key": "content_code",
        "columns": [C("content_code", "str", True, "Mã video"), C("minutes", "float", True, "Thời gian sản xuất (phút)"),
                    C("script_version", "str"), C("cost_vnd", "float", False, "Chi phí sản xuất (tạo dòng chi phí 'production')")],
        "example": {"content_code": "SV-101", "minutes": "35", "script_version": "v2-pain-point", "cost_vnd": "18000"},
    },
}

_TRUE = {"true", "1", "yes", "y", "co", "có", "x"}
_FALSE = {"false", "0", "no", "n", "khong", "không"}


@dataclass
class ImportResult:
    kind: str
    ok: int = 0
    errors: list[dict] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    duplicate: bool = False
    rejected: bool = False
    batch_id: int | None = None
    message: str = ""

    @property
    def success(self) -> bool:
        return not self.duplicate and not self.rejected and self.message == "" and self.ok > 0


# -------------------------------------------------------------------- parse
def _norm_header(h) -> str:
    return str(h or "").strip().lower().replace(" ", "_").replace("-", "_")


def parse_file(filename: str, data: bytes) -> list[dict]:
    name = filename.lower()
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook

        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        ws = wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        try:
            header = [_norm_header(h) for h in next(it)]
        except StopIteration:
            return []
        rows = []
        for r in it:
            if all(v in (None, "") for v in r):
                continue
            rows.append({header[i]: ("" if v is None else v) for i, v in enumerate(r) if i < len(header) and header[i]})
        return rows
    if not name.endswith((".csv", ".txt")):
        raise ValueError("Chỉ hỗ trợ .csv hoặc .xlsx")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("cp1252", errors="replace")
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = []
    for r in reader:
        row = {_norm_header(k): (v or "").strip() for k, v in r.items() if k}
        if any(row.values()):
            rows.append(row)
    return rows


def _coerce(col: dict, raw):
    """Returns (value, availability). Raises ValueError on invalid input."""
    typ, name = col["type"], col["name"]
    s = raw.strip() if isinstance(raw, str) else raw
    if typ == "metric":
        if s in ("", None):
            return None, "not_collected"
        if isinstance(s, str) and s.upper() == "NA":
            return None, "not_provided"
        if isinstance(s, str) and s.upper() == "NC":
            return None, "not_connected"
        v = _num(s, name)
        if v < 0:
            raise ValueError(f"{name}: không được âm")
        return v, "value"
    if s in ("", None):
        if col["required"]:
            raise ValueError(f"Thiếu giá trị bắt buộc: {name}")
        return None, "value"
    if typ == "str":
        return str(s).strip(), "value"
    if typ == "float":
        return _num(s, name), "value"
    if typ == "int":
        v = _num(s, name)
        if v != int(v):
            raise ValueError(f"{name}: phải là số nguyên")
        return int(v), "value"
    if typ == "date":
        return _date(s, name), "value"
    if typ == "datetime":
        return _datetime(s, name), "value"
    if typ == "bool":
        t = str(s).strip().lower()
        if t in _TRUE:
            return True, "value"
        if t in _FALSE:
            return False, "value"
        raise ValueError(f"{name}: dùng true/false hoặc để trống")
    if typ.startswith("enum:"):
        allowed = ENUMS[typ[5:]]
        t = str(s).strip().lower()
        if t not in allowed:
            raise ValueError(f"{name}: '{s}' không hợp lệ (chấp nhận: {', '.join(allowed)})")
        return t, "value"
    raise ValueError(f"Kiểu cột không hỗ trợ: {typ}")


def _num(s, name: str) -> float:
    if isinstance(s, (int, float)) and not isinstance(s, bool):
        return float(s)
    try:
        return float(str(s).strip())
    except ValueError:
        raise ValueError(f"{name}: '{s}' không phải số (dùng dấu chấm thập phân, không dùng dấu ngăn cách nghìn)") from None


def _datetime(s, name: str) -> datetime:
    if isinstance(s, datetime):
        return s
    t = str(s).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(t, fmt)
        except ValueError:
            continue
    raise ValueError(f"{name}: '{s}' không phải thời điểm (vd 2026-10-30 14:05:00)")


def _date(s, name: str) -> date:
    if isinstance(s, datetime):
        return s.date()
    if isinstance(s, date):
        return s
    t = str(s).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(t[:10] if fmt == "%Y-%m-%d" else t, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"{name}: '{s}' không phải ngày (YYYY-MM-DD hoặc DD/MM/YYYY)")


# ------------------------------------------------------------------- import
def file_hash(kind: str, data: bytes) -> str:
    return hashlib.sha256(kind.encode() + b"\0" + data).hexdigest()


def template_csv(kind: str) -> str:
    spec = SPECS[kind]
    cols = [c["name"] for c in spec["columns"]]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    w.writerow([spec["example"].get(c, "") for c in cols])
    return "﻿" + buf.getvalue()


def import_file(db: Session, kind: str, filename: str, data: bytes, *, is_demo: bool = False, strict: bool = True,
                source_note: str = "") -> ImportResult:
    if kind not in SPECS:
        r = ImportResult(kind)
        r.message = "Loại dữ liệu không hợp lệ"
        return r
    h = file_hash(kind, data)
    dup = db.scalar(select(ImportBatch).where(ImportBatch.file_hash == h, ImportBatch.rows_ok > 0))
    if dup:
        r = ImportResult(kind, duplicate=True, batch_id=dup.id)
        r.message = f"File này đã được nhập lúc {dup.created_at:%d/%m/%Y %H:%M} (lô #{dup.id}). Không nhập lại để tránh trùng."
        return r
    try:
        rows = parse_file(filename, data)
    except Exception as e:  # noqa: BLE001
        r = ImportResult(kind, rejected=True)
        r.message = f"Không đọc được file: {e}"
        return r
    method = "xlsx" if filename.lower().endswith((".xlsx", ".xlsm")) else "csv"
    return import_rows(db, kind, rows, filename=filename, method=method, is_demo=is_demo, strict=strict,
                       source_note=source_note, fhash=h)


def import_rows(db: Session, kind: str, rows: list[dict], *, filename: str = "", method: str = "manual", is_demo: bool = False,
                strict: bool = True, source_note: str = "", fhash: str = "") -> ImportResult:
    spec = SPECS[kind]
    res = ImportResult(kind)
    if not rows:
        res.rejected = True
        res.message = "File không có dòng dữ liệu nào."
        return res
    headers = set().union(*[set(r) for r in rows])
    known = {c["name"] for c in spec["columns"]}
    missing = [c["name"] for c in spec["columns"] if c["required"] and c["name"] not in headers]
    if missing:
        res.rejected = True
        res.message = f"Thiếu cột bắt buộc: {', '.join(missing)}. Tải file mẫu để xem đúng cấu trúc."
        return res
    unknown = sorted(headers - known)
    if unknown:
        res.warnings.append(f"Bỏ qua cột không nhận diện: {', '.join(unknown)}")

    codes = {c for (c,) in db.execute(select(Content.code))}
    demo_codes = {c for (c,) in db.execute(select(Content.code).where(Content.is_demo.is_(True)))}

    parsed: list[tuple[int, dict]] = []
    seen_keys: set = set()
    for i, raw in enumerate(rows, start=2):  # row 1 is the header
        try:
            data = {}
            for col in spec["columns"]:
                if col["name"] not in raw and col["type"] != "metric":
                    if col["required"]:
                        raise ValueError(f"Thiếu giá trị bắt buộc: {col['name']}")
                    data[col["name"]] = (None, "value")
                    continue
                data[col["name"]] = _coerce(col, raw.get(col["name"], ""))
            d = {k: v[0] for k, v in data.items()}
            av = {k: v[1] for k, v in data.items()}
            _validate(kind, d, codes, demo_codes, is_demo)
            key = _row_key(kind, d)
            if key in seen_keys:
                raise ValueError(f"Trùng khóa trong file ({key})")
            seen_keys.add(key)
            parsed.append((i, {"d": d, "av": av}))
        except ValueError as e:
            res.errors.append({"row": i, "message": str(e)})

    if res.errors and strict:
        res.rejected = True
        res.message = f"Từ chối nhập: {len(res.errors)} dòng lỗi (chế độ nghiêm ngặt: sai một dòng thì không nhập dòng nào)."
        batch = ImportBatch(kind=kind, filename=filename, file_hash="", method=method, source_note=source_note, is_demo=is_demo,
                            rows_ok=0, rows_err=len(res.errors), errors_json=json.dumps(res.errors[:200], ensure_ascii=False))
        db.add(batch)
        db.commit()
        res.batch_id = batch.id
        return res

    batch = ImportBatch(kind=kind, filename=filename, file_hash=fhash if parsed else "", method=method,
                        source_note=source_note, is_demo=is_demo, rows_ok=0, rows_err=len(res.errors),
                        errors_json=json.dumps(res.errors[:200], ensure_ascii=False))
    db.add(batch)
    db.flush()
    for _, p in parsed:
        _apply(db, kind, p["d"], p["av"], batch, is_demo)
    batch.rows_ok = len(parsed)
    res.ok = len(parsed)
    res.batch_id = batch.id
    db.commit()
    if not parsed:
        res.message = "Không có dòng hợp lệ nào được nhập."
    return res


def _row_key(kind: str, d: dict):
    return {
        "contents": lambda: d["code"], "metrics": lambda: (d["content_code"], d["date"]),
        "orders": lambda: d["order_id"], "costs": lambda: (d["content_code"], d["date"], d["cost_type"]),
        "products": lambda: d["sku"], "chat_logs": lambda: (d["ts"], d["session_id"], d["question"]), "ai_live": lambda: d["content_code"], "video_production": lambda: d["content_code"],
    }[kind]()


def _validate(kind: str, d: dict, codes: set, demo_codes: set, is_demo: bool) -> None:
    ref = d.get("content_code")
    if kind != "contents" and kind not in ("products",) and ref is not None:
        if ref not in codes:
            if kind == "orders":
                raise ValueError(f"content_code '{ref}' chưa có trong danh mục nội dung")
            raise ValueError(f"content_code '{ref}' chưa có trong danh mục nội dung (nhập danh mục trước)")
        if is_demo != (ref in demo_codes):
            raise ValueError(f"'{ref}' thuộc dữ liệu {'demo' if ref in demo_codes else 'thật'}; không trộn demo với thật")
    if kind == "costs" and d["amount"] < 0:
        raise ValueError("amount không được âm")
    if kind == "orders":
        if d["revenue"] < 0:
            raise ValueError("revenue không được âm")
        if d.get("content_code") and not d.get("attribution_method"):
            raise ValueError("Có content_code thì phải ghi attribution_method (cách xác định nguồn đơn)")
    if kind == "ai_live":
        q, a = d.get("questions_received"), d.get("questions_answered")
        if q is not None and a is not None and a > q:
            raise ValueError("questions_answered không được lớn hơn questions_received")
        if d.get("accuracy_pct") is not None and not 0 <= d["accuracy_pct"] <= 100:
            raise ValueError("accuracy_pct phải trong khoảng 0-100")
    if kind == "contents":
        if d["code"] in codes and is_demo != (d["code"] in demo_codes):
            raise ValueError(f"Mã '{d['code']}' đã tồn tại ở nhóm dữ liệu {'demo' if d['code'] in demo_codes else 'thật'}")
        if d.get("commission_rate") is not None and not 0 <= d["commission_rate"] <= 100:
            raise ValueError("commission_rate phải trong khoảng 0-100 (%)")


def _apply(db: Session, kind: str, d: dict, av: dict, batch: ImportBatch, is_demo: bool) -> None:
    if kind == "contents":
        obj = db.get(Content, d["code"]) or Content(code=d["code"])
        for k, v in d.items():
            if k == "code" or v is None:
                continue
            setattr(obj, k, v)
        obj.is_demo = is_demo
        db.add(obj)
    elif kind == "metrics":
        for key in METRIC_KEYS:
            val, avail = d.get(key), av.get(key, "not_collected")
            existing = db.scalar(select(MetricFact).where(MetricFact.content_code == d["content_code"],
                                                          MetricFact.date == d["date"], MetricFact.metric_key == key))
            raw_empty = avail == "not_collected"
            if existing:
                if raw_empty:  # an empty cell never overwrites an existing value
                    continue
                existing.value, existing.availability, existing.batch_id, existing.is_demo = val, avail, batch.id, is_demo
            else:
                db.add(MetricFact(content_code=d["content_code"], date=d["date"], metric_key=key, value=val,
                                  availability=avail, batch_id=batch.id, is_demo=is_demo))
    elif kind == "orders":
        o = db.get(Order, d["order_id"]) or Order(order_id=d["order_id"])
        o.order_date, o.status, o.revenue, o.sku = d["order_date"], d["status"], d["revenue"], d.get("sku") or ""
        o.is_new_customer, o.is_demo, o.batch_id = d.get("is_new_customer"), is_demo, batch.id
        db.add(o)
        db.flush()
        if d.get("content_code"):
            a = db.get(OrderAttribution, d["order_id"]) or OrderAttribution(order_id=d["order_id"], content_code=d["content_code"])
            a.content_code, a.method, a.window_days = d["content_code"], d["attribution_method"], d.get("window_days")
            db.add(a)
    elif kind == "costs":
        c = db.scalar(select(Cost).where(Cost.content_code == d["content_code"], Cost.date == d["date"], Cost.cost_type == d["cost_type"]))
        if c:
            c.amount, c.batch_id, c.is_demo = d["amount"], batch.id, is_demo
        else:
            db.add(Cost(content_code=d["content_code"], date=d["date"], cost_type=d["cost_type"], amount=d["amount"],
                        batch_id=batch.id, is_demo=is_demo))
    elif kind == "products":
        p = db.get(Product, d["sku"]) or Product(sku=d["sku"], name=d["name"])
        for k in ("name", "price", "flash_price", "stock", "flavor", "spice_level", "shelf_life", "shopee_url"):
            if d.get(k) is not None:
                setattr(p, k, d[k])
        p.source, p.is_demo, p.updated_at = ("demo" if is_demo else "csv"), is_demo, datetime.now()
        db.add(p)
    elif kind == "chat_logs":
        x = db.scalar(select(ChatLog).where(ChatLog.ts == d["ts"], ChatLog.session_id == d["session_id"], ChatLog.question == d["question"])) or ChatLog(
            ts=d["ts"], session_id=d["session_id"], question=d["question"])
        x.intent, x.sku = d.get("intent") or "", d.get("sku") or ""
        x.latency_ms, x.cost_vnd, x.correct = d.get("latency_ms"), d.get("cost_vnd"), d.get("correct")
        x.handoff, x.clicked_buy, x.is_demo = bool(d.get("handoff")), bool(d.get("clicked_buy")), is_demo
        db.add(x)
    elif kind == "ai_live":
        s = db.get(AiLiveSession, d["content_code"]) or AiLiveSession(content_code=d["content_code"])
        for k, v in d.items():
            if k != "content_code":
                setattr(s, k, v)
        s.is_demo, s.batch_id = is_demo, batch.id
        db.add(s)
    elif kind == "video_production":
        v = db.get(VideoProduction, d["content_code"]) or VideoProduction(content_code=d["content_code"])
        v.minutes, v.script_version, v.is_demo, v.batch_id = d["minutes"], d.get("script_version") or "", is_demo, batch.id
        db.add(v)
        if d.get("cost_vnd") is not None:
            content = db.get(Content, d["content_code"])
            day = (content.published_at if content and content.published_at else date.today())
            c = db.scalar(select(Cost).where(Cost.content_code == d["content_code"], Cost.date == day, Cost.cost_type == "production"))
            if c:
                c.amount, c.batch_id, c.is_demo = d["cost_vnd"], batch.id, is_demo
            else:
                db.add(Cost(content_code=d["content_code"], date=day, cost_type="production", amount=d["cost_vnd"],
                            batch_id=batch.id, is_demo=is_demo))
    db.flush()
