import pytest

from app.core.text import fold, slugify


@pytest.mark.parametrize(
    "given,expected",
    [
        ("Bánh tráng trộn Tây Ninh", "banh trang tron tay ninh"),
        ("ĐẶC SẢN Đà Lạt", "dac san da lat"),
        ("Xoài sấy dẻo", "xoai say deo"),
        ("already plain", "already plain"),
    ],
)
def test_fold_removes_vietnamese_accents(given, expected):
    assert fold(given) == expected


def test_slugify_is_url_safe_and_never_empty():
    assert slugify("Bánh tráng trộn Tây Ninh") == "banh-trang-tron-tay-ninh"
    assert slugify("  Khô gà / lá chanh!! ") == "kho-ga-la-chanh"
    assert slugify("!!!") == "item"
    assert len(slugify("a" * 500)) <= 80
