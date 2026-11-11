"""Configure private chatbot credentials locally without displaying them."""

import getpass
import json
import re
from pathlib import Path


def main():
    print("Use a NEW Gemini key. Revoke any key previously shared in chat.")
    print("In AI Studio, check the key's project is Free Tier with NO billing account linked.")
    if input("Confirmed? Type FREE: ").strip() != "FREE":
        print("No settings changed.")
        return
    key = getpass.getpass("New Gemini API key (hidden): ").strip()
    if not key:
        print("No settings changed.")
        return
    target = Path(__file__).resolve().parent / ".env"
    text = target.read_text(encoding="utf-8") if target.exists() else ""
    updates = {
        "GEMINI_API_KEY": key,
        "GEMINI_MODEL": "gemini-3.1-flash-lite",
        "GEMINI_FREE_TIER_CONFIRMED": "true",
        "CHAT_ALL_SALE_PRODUCTS": "true",
    }
    for name, prompt, default in [
        ("ODOO_URL", "Odoo URL", "https://edu-anvatuit.odoo.com"),
        ("ODOO_DATABASE", "Odoo database", "edu-anvatuit"),
        ("ODOO_LOGIN", "Odoo login email", ""),
        ("ODOO_API_KEY", "Odoo API key", ""),
    ]:
        existing = re.search(r"^" + name + r"[ \t]*=[ \t]*([^\r\n]*)", text, re.MULTILINE)
        if existing and existing.group(1).strip().strip("\"'"):
            continue
        value = (
            getpass.getpass(prompt + " (hidden): ")
            if name.endswith("KEY")
            else input(prompt + (" [" + default + "]" if default else "") + ": ")
        )
        updates[name] = value.strip() or default
    if not re.search(r"^CHAT_PUBLIC_SKUS\s*=", text, re.MULTILINE):
        updates["CHAT_PUBLIC_SKUS"] = json.dumps(
            ["BANH-TRANG-ME-01", "BAP-RANG-01", "BIM-BIM-100", "BT-BO-01", "BT-CHAM-01"]
        )
    for name, value in updates.items():
        line = name + "=" + json.dumps(value, ensure_ascii=False)
        pattern = r"^" + name + r"\s*=.*$"
        if re.search(pattern, text, re.MULTILINE):
            text = re.sub(pattern, lambda _, replacement=line: replacement, text, flags=re.MULTILINE)
        else:
            text = text.rstrip() + "\n" + line + "\n"
    target.write_text(text, encoding="utf-8")
    print("Saved private settings to api/.env. Restart the API to apply.")


if __name__ == "__main__":
    main()
