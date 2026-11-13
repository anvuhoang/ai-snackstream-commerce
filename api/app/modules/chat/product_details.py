"""Extract only explicitly labeled customer-facing facts, never raw internal notes."""

import re
from html import unescape

LABELS = {
    "ingredients": "Ingredients",
    "thành phần": "Ingredients",
    "storage": "Storage",
    "bảo quản": "Storage",
    "flavor and texture": "Flavor and texture",
    "hương vị": "Flavor and texture",
}
# Unknown labels are boundaries too, so Cost/Supplier/etc. cannot trail a public section.
SECTION = re.compile(r"(?<!\w)([A-Za-zÀ-ỹ][A-Za-zÀ-ỹ /&-]{0,39}):\s*")
PRIVATE = re.compile(r"\b(cost|supplier|password|secret|api[_ -]?key)\b|giá vốn|nhà cung cấp", re.I)


def public_description(sales: str | bool | None, notes: str | bool | None) -> str | None:
    sales = (sales or "").strip()[:4000]
    # Read only the standard textual sections used by this shop, not arbitrary prose.
    text = unescape(re.sub(r"<[^>]*>", "\n", notes or ""))[:20000]
    matches = list(SECTION.finditer(text))
    sections = []
    for index, match in enumerate(matches):
        label = LABELS.get(match.group(1).strip().casefold())
        if not label:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        value = text[match.end() : end].strip()[:1200]
        if value and not PRIVATE.search(value):
            sections.append(f"{label}: {value}")
    # A sales description, if supplied, remains the primary source to avoid conflicts.
    return sales or ("\n".join(sections)[:4000] or None)
