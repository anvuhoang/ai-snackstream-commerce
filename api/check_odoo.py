"""Read-only Odoo connection check. Run: python check_odoo.py."""

import getpass
import os
import socket
import xmlrpc.client

URL = "https://edu-anvatuit.odoo.com"


def main():
    socket.setdefaulttimeout(25)
    print(f"Odoo: {URL}")
    common = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/common")
    try:
        version = common.version()
        print(f"Version: {version.get('server_version', 'unknown')}")
        database = input("Database [edu-anvatuit]: ").strip() or "edu-anvatuit"
        login = input("Odoo login email: ").strip()
        if not login:
            print("Email is required.")
            return 1
        key = os.environ.get("ODOO_API_KEY") or getpass.getpass("API key (hidden): ")
        if not key:
            print("API key is required.")
            return 1
        uid = common.authenticate(database, login, key, {})
        if not uid:
            print("Login failed. Check database, email, API key and API access plan.")
            return 1
        models = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/object")
        products = models.execute_kw(
            database,
            uid,
            key,
            "product.product",
            "search_read",
            [[["sale_ok", "=", True]]],
            {"fields": ["name", "default_code", "lst_price", "currency_id"], "limit": 5},
        )
        print("SUCCESS: authenticated and read products (no data changed).")
        if not products:
            print("No saleable products visible to this user.")
        for product in products:
            print(
                f"SKU: {product['default_code'] or '(missing)'} | "
                f"{product['name']} | Price: {product['lst_price']} | "
                f"Currency: {product['currency_id']}"
            )
        print("Stock access and available quantities require a separate check.")
        return 0
    except xmlrpc.client.Fault as exc:
        # Do not print server payloads: they may include confidential context.
        print(
            f"Odoo rejected the request (fault {exc.faultCode}). "
            "Check API access, database and product read permissions."
        )
        return 1
    except (OSError, xmlrpc.client.Error):
        print("Connection failed. Check network, URL and RPC availability.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
