"""Image upload: what is accepted, where it goes, and that the uploader's file name is never trusted."""

from .helpers import ADMIN, PNG, make_product


def upload(client, product_id, data=PNG, filename="../../evil name.png", content_type="image/png", alt="Ảnh"):
    return client.post(
        f"{ADMIN}/products/{product_id}/images",
        files={"file": (filename, data, content_type)},
        data={"alt": alt},
    )


def test_upload_stores_the_image_and_serves_it(signed_in, anon):
    p = make_product(signed_in)
    r = upload(signed_in, p["id"])
    assert r.status_code == 201, r.text
    image = r.json()["images"][0]
    assert image["alt"] == "Ảnh" and image["url"].startswith("/api/media/") and image["url"].endswith(".png")
    assert "evil" not in image["url"]  # a random name is used, never the uploaded one
    served = anon.get(image["url"])
    assert served.status_code == 200 and served.content == PNG


def test_the_cover_is_the_first_upload_and_order_can_change(signed_in):
    p = make_product(signed_in)
    upload(signed_in, p["id"], alt="một")
    two = upload(signed_in, p["id"], alt="hai").json()
    assert [i["alt"] for i in two["images"]] == ["một", "hai"]
    second = two["images"][1]["id"]
    moved = signed_in.patch(f"{ADMIN}/images/{second}", json={"sortOrder": -1}).json()
    assert [i["alt"] for i in moved["images"]] == ["hai", "một"]


def test_only_real_images_are_accepted(signed_in):
    p = make_product(signed_in)
    fake = upload(signed_in, p["id"], data=b"<script>alert(1)</script>", content_type="image/png")
    assert fake.status_code == 415 and fake.json()["error"]["code"] == "unsupported_image_type"
    gif = upload(signed_in, p["id"], data=b"GIF89a" + b"0" * 20, content_type="image/gif")
    assert gif.status_code == 415
    assert upload(signed_in, p["id"], data=b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"0" * 20).status_code == 201
    assert upload(signed_in, p["id"], data=b"\xff\xd8\xff\xe0" + b"0" * 20).status_code == 201


def test_oversized_uploads_are_rejected(signed_in, settings):
    p = make_product(signed_in)
    r = upload(signed_in, p["id"], data=PNG + b"0" * settings.max_upload_bytes)
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"
    assert signed_in.get(f"{ADMIN}/products/{p['id']}").json()["images"] == []


def test_delete_removes_the_row_and_the_file(signed_in, anon, settings):
    from pathlib import Path

    p = make_product(signed_in)
    image = upload(signed_in, p["id"]).json()["images"][0]
    file = Path(settings.media_dir) / image["url"].rsplit("/", 1)[1]
    assert file.exists()
    after = signed_in.delete(f"{ADMIN}/images/{image['id']}").json()
    assert after["images"] == [] and not file.exists()
    assert anon.get(image["url"]).status_code == 404
    assert signed_in.delete(f"{ADMIN}/images/{image['id']}").status_code == 404


def test_only_admins_may_upload(anon, staff, signed_in):
    p = make_product(signed_in)
    assert upload(anon, p["id"]).status_code == 401
    assert upload(staff, p["id"]).status_code == 403
    assert upload(signed_in, 99999).status_code == 404


def test_uploaded_files_cannot_escape_the_media_folder(anon):
    for path in ("/api/media/../../pyproject.toml", "/api/media/%2e%2e/pyproject.toml"):
        assert anon.get(path).status_code in (404, 400)
