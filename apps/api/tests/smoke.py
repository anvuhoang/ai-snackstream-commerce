"""Quick smoke test of the whole API against a temporary DB: python tests/smoke.py"""
import os
import sys
import tempfile

tmp = os.path.join(tempfile.mkdtemp(), "smoke.db")
os.environ["DATABASE_URL"] = "sqlite:///" + tmp.replace("\\", "/")
os.environ["SEED_DEMO"] = "1"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

with TestClient(app) as c:
    r = c.get("/api/overview")
    print("overview khi chưa đăng nhập:", r.status_code)
    assert r.status_code == 401
    r = c.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    print("login:", r.status_code)
    csrf = r.json()["csrf"]
    paths = ["/api/meta", "/api/overview", "/api/overview?rank=roas", "/api/shopee?tab=shop", "/api/shopee?tab=live", "/api/shopee?tab=video",
             "/api/shopee?tab=ads", "/api/external", "/api/funnel", "/api/funnel?cmp=prev", "/api/funnel?path=website&platform=tiktok", "/api/ai",
             "/api/products", "/api/data/overview", "/api/export/noi_dung.csv", "/api/export/nen_tang.csv", "/api/export/don_hang.csv",
             "/api/data/template/orders.csv", "/api/public/products", "/healthz"]
    bad = 0
    for p in paths:
        r = c.get(p)
        ok = r.status_code == 200
        bad += not ok
        print("OK " if ok else "ERR", p, r.status_code, len(r.content) if ok else r.text[:300])
    r = c.post("/api/data/seed")
    print("POST thiếu CSRF:", r.status_code)
    assert r.status_code == 403
    r = c.post("/api/data/seed", headers={"X-CSRF-Token": csrf})
    print("POST có CSRF:", r.status_code, r.json())
    sys.exit(1 if bad else 0)
