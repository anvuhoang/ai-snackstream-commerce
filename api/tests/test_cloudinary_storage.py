from __future__ import annotations

import hashlib

import httpx
import pytest

from app.core.config import Settings
from app.core.storage import CloudinaryStorage, LocalMediaStorage, build_storage

URL = "cloudinary://123456:s3cret@democloud"


def make(handler) -> CloudinaryStorage:
    return CloudinaryStorage(URL, client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_save_signs_the_upload_and_returns_a_bare_key():
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"public_id": "x"})

    key = make(handler).save(b"img", ".webp")
    assert key.endswith(".webp") and "/" not in key
    req = seen[0]
    assert str(req.url) == "https://api.cloudinary.com/v1_1/democloud/image/upload"
    body = req.content.decode("latin-1")
    ts = body.split('name="timestamp"\r\n\r\n')[1].split("\r\n")[0]
    public_id = f"snackstream/{key[:-5]}"
    assert f'name="public_id"\r\n\r\n{public_id}' in body
    expected = hashlib.sha1(f"public_id={public_id}&timestamp={ts}s3cret".encode()).hexdigest()
    assert expected in body
    assert "s3cret" not in body  # the secret signs the request but is never sent


def test_save_failure_raises():
    with pytest.raises(RuntimeError):
        make(lambda req: httpx.Response(401)).save(b"x", ".jpg")


def test_url_points_at_the_cdn():
    assert make(lambda r: httpx.Response(200)).url("abc.webp") == (
        "https://res.cloudinary.com/democloud/image/upload/snackstream/abc.webp"
    )


def test_delete_never_raises():
    def boom(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    make(boom).delete("abc.webp")
    make(lambda r: httpx.Response(200)).delete("../evil.webp")  # not a bare name: ignored


def test_put_if_missing_skips_a_file_that_exists_and_uploads_a_gap():
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req.method)
        if req.method == "HEAD":
            return httpx.Response(200 if "have" in str(req.url) else 404)
        return httpx.Response(200)

    storage = make(handler)
    storage.put_if_missing("seed-have.webp", b"x")
    assert calls == ["HEAD"]
    storage.put_if_missing("seed-gap.webp", b"x")
    assert calls == ["HEAD", "HEAD", "POST"]


def test_bad_url_is_rejected():
    with pytest.raises(ValueError):
        CloudinaryStorage("https://example.com")


def test_build_storage_picks_by_setting(tmp_path):
    base = {"APP_ENV": "test", "DATABASE_URL": "sqlite://", "SECRET_KEY": "t", "MEDIA_DIR": str(tmp_path)}
    assert isinstance(build_storage(Settings(**base, _env_file=None)), LocalMediaStorage)
    assert isinstance(build_storage(Settings(**base, CLOUDINARY_URL=URL, _env_file=None)), CloudinaryStorage)
