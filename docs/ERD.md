# Database design (ERD)

PostgreSQL in production, SQLite for the fast unit-test run. The schema is owned by Alembic (`api/alembic/versions`, one linear
history). **25 tables**: the first diagram shows all of them with every column, then one diagram per module.
The diagrams were taken from the SQLAlchemy models (`api/app/modules/*/models.py`); update this page in the same pull request that changes a model.

Conventions: money is integer VND; timestamps are UTC; a missing value is `NULL` plus a status, never `0`.
`PK` primary key, `FK` foreign key, `UK` unique. A relationship drawn with `|o` on the parent side means the foreign key is optional.

## Whole schema

```mermaid
erDiagram
    cart ||--o{ cart_item : "contains"
    variant ||--o{ cart_item : "added as"
    import_batch ||--o{ channel_metric : "contains"
    customer ||--o{ customer_token : "receives"
    orders |o--o{ event : "tracked in"
    orders ||--o{ idempotency_key : "created once by"
    admin_user |o--o{ import_batch : "uploads"
    orders ||--o{ order_item : "contains"
    variant ||--o{ order_item : "sold as"
    orders ||--o{ order_status_history : "history"
    admin_user |o--o{ order_status_history : "performs"
    customer |o--o{ orders : "places"
    orders ||--o{ payment : "paid by"
    category |o--o{ product : "groups"
    product ||--o{ product_image : "has pictures"
    variant ||--o{ stock_level : "counted in"
    variant ||--o{ stock_movement : "changes recorded in"
    orders |o--o{ stock_movement : "reserves and releases"
    admin_user |o--o{ stock_movement : "performs"
    product ||--o{ variant : "has variants"
    admin_user {
        int id PK
        string email UK
        string password_hash
        string role
        bool is_active
        datetime created_at
        datetime updated_at
    }
    cart {
        int id PK
        string token UK
        datetime created_at
        datetime updated_at
    }
    cart_item {
        int id PK
        int cart_id FK
        int variant_id FK
        int qty
    }
    category {
        int id PK
        string slug UK
        string name
        int sort_order
        datetime created_at
        datetime updated_at
    }
    channel_metric {
        int id PK
        int batch_id FK
        date day
        string channel
        string content_code
        string metric
        bigint value
        bool is_demo
    }
    chat_faq {
        int id PK
        string question
        text answer
        bool approved
    }
    chat_log {
        int id PK
        string question_id UK
        string conversation_id
        text question
        text answer
        string sku
        text product_skus
        datetime received_at
        datetime answered_at
        int duration_ms
        string outcome
        string error_code
        bool reviewed_correct
        bool card_clicked
    }
    chat_settings {
        int id PK
        bool enabled
        text contact_text
    }
    chat_support {
        int id PK
        string conversation_id UK
        text message
        string state
        datetime created_at
    }
    customer {
        int id PK
        string email UK
        string password_hash
        string full_name
        string phone
        string ship_address
        string ship_ward
        string ship_district
        string ship_province
        bool is_active
        datetime email_verified_at
        datetime created_at
        datetime updated_at
    }
    customer_token {
        int id PK
        int customer_id FK
        string kind
        string token_hash UK
        datetime expires_at
        datetime used_at
        datetime created_at
    }
    event {
        int id PK
        string event_id UK
        string name
        string session_id
        datetime occurred_at
        bool is_demo
        string sku
        string source
        string campaign
        string content_code
        string surface
        int qty
        int cart_value_vnd
        int order_id FK
        string live_id
        string conversation_id
    }
    idempotency_key {
        int id PK
        string key UK
        string request_hash
        int order_id FK
        datetime created_at
    }
    import_batch {
        int id PK
        string kind
        string filename
        string sha256 UK
        bool is_demo
        int rows_total
        int values_imported
        int values_skipped
        int created_by FK
        datetime created_at
    }
    kb_chunk {
        int id PK
        string source_type
        string source_key
        string kind
        string sku
        string title
        text text
        string content_hash
        string embedder
        int dim
        text embedding
        datetime updated_at
    }
    order_item {
        int id PK
        int order_id FK
        int variant_id FK
        string sku
        string product_name
        string variant_name
        int unit_price_vnd
        int qty
        int line_total_vnd
    }
    order_status_history {
        int id PK
        int order_id FK
        string from_status
        string to_status
        int actor_id FK
        string note
        datetime created_at
    }
    orders {
        int id PK
        string code UK
        int customer_id FK
        string status
        string customer_name
        string customer_phone
        string ship_address
        string ship_ward
        string ship_district
        string ship_province
        string note
        int subtotal_vnd
        int shipping_fee_vnd
        int total_vnd
        string payment_method
        datetime expires_at
        string session_id
        string utm_source
        string utm_campaign
        string utm_content
        bool is_demo
        datetime created_at
        datetime updated_at
    }
    payment {
        int id PK
        int order_id FK
        string provider
        string status
        int amount_vnd
        string provider_ref
        text last_payload
        datetime paid_at
        datetime created_at
        datetime updated_at
    }
    product {
        int id PK
        string slug UK
        string name
        text description
        text ingredients
        text storage
        text allergens
        string spice_level
        text nutrition
        bool ingredients_verified
        string status
        int category_id FK
        string shopee_url
        bool is_demo
        text search_text
        datetime created_at
        datetime updated_at
    }
    product_image {
        int id PK
        int product_id FK
        string storage_key
        string alt
        int sort_order
        datetime created_at
        datetime updated_at
    }
    stock_level {
        int variant_id PK,FK
        int on_hand
        int reserved
        string source
        datetime synced_at
        datetime updated_at
    }
    stock_movement {
        int id PK
        int variant_id FK
        string kind
        int delta_on_hand
        int delta_reserved
        int order_id FK
        int actor_id FK
        string note
        datetime created_at
    }
    stock_sync_run {
        int id PK
        datetime started_at
        datetime finished_at
        bool ok
        int matched
        int changed
        text missing_skus
        string error
    }
    variant {
        int id PK
        int product_id FK
        string sku UK
        string name
        int price_vnd
        int compare_at_vnd
        int weight_g
        bool is_active
        int sort_order
        datetime created_at
        datetime updated_at
    }
```

## Accounts and staff

```mermaid
erDiagram
    customer ||--o{ customer_token : "receives"
    admin_user {
        int id PK
        string email UK
        string password_hash
        string role
        bool is_active
        datetime created_at
        datetime updated_at
    }
    customer {
        int id PK
        string email UK
        string password_hash
        string full_name
        string phone
        string ship_address
        string ship_ward
        string ship_district
        string ship_province
        bool is_active
        datetime email_verified_at
        datetime created_at
        datetime updated_at
    }
    customer_token {
        int id PK
        int customer_id FK
        string kind
        string token_hash UK
        datetime expires_at
        datetime used_at
        datetime created_at
    }
```

## Catalog

```mermaid
erDiagram
    category |o--o{ product : "groups"
    product ||--o{ variant : "has variants"
    product ||--o{ product_image : "has pictures"
    category {
        int id PK
        string slug UK
        string name
        int sort_order
        datetime created_at
        datetime updated_at
    }
    product {
        int id PK
        string slug UK
        string name
        text description
        text ingredients
        text storage
        text allergens
        string spice_level
        text nutrition
        bool ingredients_verified
        string status
        int category_id FK
        string shopee_url
        bool is_demo
        text search_text
        datetime created_at
        datetime updated_at
    }
    variant {
        int id PK
        int product_id FK
        string sku UK
        string name
        int price_vnd
        int compare_at_vnd
        int weight_g
        bool is_active
        int sort_order
        datetime created_at
        datetime updated_at
    }
    product_image {
        int id PK
        int product_id FK
        string storage_key
        string alt
        int sort_order
        datetime created_at
        datetime updated_at
    }
```

## Cart, orders and payments

```mermaid
erDiagram
    cart ||--o{ cart_item : "contains"
    variant ||--o{ cart_item : "added as"
    customer |o--o{ orders : "places"
    orders ||--o{ order_item : "contains"
    variant ||--o{ order_item : "sold as"
    orders ||--o{ order_status_history : "history"
    admin_user |o--o{ order_status_history : "performs"
    orders ||--o{ payment : "paid by"
    orders ||--o{ idempotency_key : "created once by"
    cart {
        int id PK
        string token UK
        datetime created_at
        datetime updated_at
    }
    cart_item {
        int id PK
        int cart_id FK
        int variant_id FK
        int qty
    }
    orders {
        int id PK
        string code UK
        int customer_id FK
        string status
        string customer_name
        string customer_phone
        string ship_address
        string ship_ward
        string ship_district
        string ship_province
        string note
        int subtotal_vnd
        int shipping_fee_vnd
        int total_vnd
        string payment_method
        datetime expires_at
        string session_id
        string utm_source
        string utm_campaign
        string utm_content
        bool is_demo
        datetime created_at
        datetime updated_at
    }
    order_item {
        int id PK
        int order_id FK
        int variant_id FK
        string sku
        string product_name
        string variant_name
        int unit_price_vnd
        int qty
        int line_total_vnd
    }
    order_status_history {
        int id PK
        int order_id FK
        string from_status
        string to_status
        int actor_id FK
        string note
        datetime created_at
    }
    payment {
        int id PK
        int order_id FK
        string provider
        string status
        int amount_vnd
        string provider_ref
        text last_payload
        datetime paid_at
        datetime created_at
        datetime updated_at
    }
    idempotency_key {
        int id PK
        string key UK
        string request_hash
        int order_id FK
        datetime created_at
    }
    admin_user {
        int id PK
    }
    customer {
        int id PK
    }
    variant {
        int id PK
        int product_id FK
    }
```

## Inventory

```mermaid
erDiagram
    variant ||--o{ stock_level : "counted in"
    variant ||--o{ stock_movement : "changes recorded in"
    orders |o--o{ stock_movement : "reserves and releases"
    admin_user |o--o{ stock_movement : "performs"
    stock_level {
        int variant_id PK,FK
        int on_hand
        int reserved
        string source
        datetime synced_at
        datetime updated_at
    }
    stock_movement {
        int id PK
        int variant_id FK
        string kind
        int delta_on_hand
        int delta_reserved
        int order_id FK
        int actor_id FK
        string note
        datetime created_at
    }
    stock_sync_run {
        int id PK
        datetime started_at
        datetime finished_at
        bool ok
        int matched
        int changed
        text missing_skus
        string error
    }
    admin_user {
        int id PK
    }
    orders {
        int id PK
        int customer_id FK
    }
    variant {
        int id PK
        int product_id FK
    }
```

## Chatbot and knowledge base

```mermaid
erDiagram
    chat_log {
        int id PK
        string question_id UK
        string conversation_id
        text question
        text answer
        string sku
        text product_skus
        datetime received_at
        datetime answered_at
        int duration_ms
        string outcome
        string error_code
        bool reviewed_correct
        bool card_clicked
    }
    chat_faq {
        int id PK
        string question
        text answer
        bool approved
    }
    chat_settings {
        int id PK
        bool enabled
        text contact_text
    }
    chat_support {
        int id PK
        string conversation_id UK
        text message
        string state
        datetime created_at
    }
    kb_chunk {
        int id PK
        string source_type
        string source_key
        string kind
        string sku
        string title
        text text
        string content_hash
        string embedder
        int dim
        text embedding
        datetime updated_at
    }
```

## Analytics

```mermaid
erDiagram
    orders |o--o{ event : "tracked in"
    admin_user |o--o{ import_batch : "uploads"
    import_batch ||--o{ channel_metric : "contains"
    event {
        int id PK
        string event_id UK
        string name
        string session_id
        datetime occurred_at
        bool is_demo
        string sku
        string source
        string campaign
        string content_code
        string surface
        int qty
        int cart_value_vnd
        int order_id FK
        string live_id
        string conversation_id
    }
    import_batch {
        int id PK
        string kind
        string filename
        string sha256 UK
        bool is_demo
        int rows_total
        int values_imported
        int values_skipped
        int created_by FK
        datetime created_at
    }
    channel_metric {
        int id PK
        int batch_id FK
        date day
        string channel
        string content_code
        string metric
        bigint value
        bool is_demo
    }
    admin_user {
        int id PK
    }
    orders {
        int id PK
        int customer_id FK
    }
```

## Design notes

- **Orders are snapshots.** `order_item` copies name, SKU and price when the order is placed, so later catalog edits never change history.
  `orders.code` is a random public token (never a counter); the customer sees only their own orders.
- **Stock is a ledger.** `stock_level` holds the current `on_hand` and `reserved`; every change also writes a `stock_movement` row.
  Reserving stock happens in the same database transaction as creating the order.
- **Payments are separate from orders** (`payment`), so "completed" and "paid" can differ (cash on delivery, payOS).
- **Customer tokens** (`customer_token`) store only the SHA-256 hash of an e-mail link token, never the token itself.
- **Chatbot passages** (`kb_chunk`) are derived data rebuilt from products, approved FAQs and policy files; they can be dropped and rebuilt.
- **Real and demo data** are flagged (`is_demo`) and never mixed silently in a report.
