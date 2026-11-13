# ERD · P2 Cart, orders, payments

Implemented in migration `0003` (module `app/modules/orders`). Money is integer VND. Customers have no accounts.
`variant` comes from P1 (catalog) and `admin_user` from P0 (auth); everything else is new in P2.

```mermaid
erDiagram
    variant ||--o{ cart_item : "added as"
    cart ||--o{ cart_item : contains
    variant ||--o{ order_item : "snapshotted from"
    orders ||--|{ order_item : contains
    orders ||--o{ order_status_history : "changes recorded in"
    orders ||--o{ payment : "paid by"
    admin_user ||--o{ order_status_history : "performed by"
    orders ||--o| idempotency_key : "created by"

    cart {
        int id PK
        string token UK "random, lives in the cookie"
        datetime created_at
        datetime updated_at
    }
    cart_item {
        int id PK
        int cart_id FK
        int variant_id FK
        int qty "1..99"
    }
    orders {
        int id PK
        string code UK "random public token, never a counter"
        string status "new|confirmed|shipping|completed|cancelled"
        string customer_name
        string customer_phone
        string ship_address
        string ship_ward
        string ship_district
        string ship_province
        string note
        int subtotal_vnd
        int shipping_fee_vnd
        int total_vnd "= subtotal + shipping"
        string payment_method "cod|vnpay"
        datetime expires_at "unpaid online orders only"
        datetime created_at
        datetime updated_at
    }
    order_item {
        int id PK
        int order_id FK
        int variant_id FK "RESTRICT: history must survive"
        string sku "snapshot"
        string product_name "snapshot"
        string variant_name "snapshot"
        int unit_price_vnd "snapshot"
        int qty
        int line_total_vnd "= unit_price * qty"
    }
    order_status_history {
        int id PK
        int order_id FK
        string from_status "null for the first row"
        string to_status
        int actor_id FK "admin_user, null for customer or system"
        string note
        datetime created_at
    }
    payment {
        int id PK
        int order_id FK
        string provider "cod|vnpay"
        string status "pending|paid|failed|expired"
        int amount_vnd
        string provider_ref "gateway transaction reference"
        text last_payload "last callback, for audit"
        datetime paid_at
        datetime created_at
    }
    idempotency_key {
        int id PK
        string key UK "from the Idempotency-Key header"
        string request_hash "same key + other body is rejected"
        int order_id FK
        datetime created_at
    }
```

## Table notes

- **`orders`** is named plural because `order` is a reserved SQL word. Order status and payment status are separate:
  a `completed` order can have a `pending` COD payment until cash is collected.
- **`order.code`** is a long random token (not a counter), so another customer's order cannot be guessed. Lookup needs
  the code **and** the phone number.
- **`order_item`** copies sku, names and unit price at purchase time. Later price edits or a hidden product never
  change an old order. `variant_id` is `RESTRICT`, and variants are never deleted anyway.
- **`cart_item`** has `UNIQUE(cart_id, variant_id)`: adding the same variant again raises the quantity. The cart never
  stores a price; it is read from the catalog every time.
- **`payment`** has `UNIQUE(provider, provider_ref)`, so the same gateway callback arriving twice cannot create or flip
  a payment twice.
- **`idempotency_key`**: a repeated checkout with the same key and the same body returns the same order; the same key
  with a different body is an error.

## Rules the schema enforces (check constraints)

- `qty` between 1 and 99; `unit_price_vnd`, `subtotal_vnd`, `shipping_fee_vnd`, `total_vnd`, `amount_vnd` are `>= 0`.
- `total_vnd = subtotal_vnd + shipping_fee_vnd` and `line_total_vnd = unit_price_vnd * qty`.
- `status`, `payment_method`, `provider` and payment `status` only accept the listed values.

## Decisions this draft assumes (change them now, not after the migration)

1. **Shipping fee (D4):** flat fee, free above a threshold. Suggested 30,000đ and free from 300,000đ; kept in settings,
   not in the database. *Need your numbers.*
2. **Stock:** no stock columns here. P3 adds `inventory` tables and a `StockProvider`; P2 only calls a no-op
   `reserve()` / `release()` seam so P3 can plug in without changing orders.
3. **Attribution:** `orders` has no UTM or campaign columns yet. P4 adds them in its own migration, when the
   attribution rule (window, first vs. last touch) is decided.
4. **Abandoned carts** are never deleted by P2; a cleanup job can come later.
5. **Online payment expiry:** `orders.expires_at` is set only for unpaid online orders (suggested 15 minutes). A job
   marks the payment `expired` and the order `cancelled` once.
