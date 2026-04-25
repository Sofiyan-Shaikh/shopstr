# Shopstr — Summer of Bitcoin Competency Test

**Applicant:** Sofiyan Shaikh  
**Email:** sofiyanshaikh0007@gmail.com  
**Project:** Shopstr — NIP-99 read path exploration

---

## Task 1 — Standalone Node.js fetch script

**File:** [`scripts/fetch-products.mjs`](scripts/fetch-products.mjs)

A self-contained Node.js script that fetches live kind 30402 (NIP-99 classified listing) events from a public Nostr relay and prints each one as a parsed `ProductData` object. It has **zero Next.js or React dependencies** and runs with plain `node`.

### What is inlined

| Production source                                             | Inlined as                                         |
| ------------------------------------------------------------- | -------------------------------------------------- |
| `utils/parsers/product-tag-helpers.ts` → `parseShippingTag()` | `parseShippingTag()` in script                     |
| `utils/parsers/product-parser-functions.ts` → `parseTags()`   | `parseTags()` in script                            |
| `utils/nostr/nostr-manager.ts` → `NostrManager.fetch()`       | `fetchProducts()` using `nostr-tools` `SimplePool` |

### Usage

```bash
# Install deps (once)
npm install

# Fetch 10 listings from the default relay
node scripts/fetch-products.mjs

# Custom relay and event limit
node scripts/fetch-products.mjs wss://nos.lol 25
node scripts/fetch-products.mjs wss://relay.damus.io 50
```

### What the output looks like

```
Connecting to wss://relay.damus.io, requesting up to 10 kind:30402 events…

Received 10 events. Parsing…

============================================================
{
  "id": "abc123…",
  "pubkey": "def456…",
  "createdAt": 1713800000,
  "title": "Handmade leather wallet",
  "summary": "Genuine cowhide, fits 8 cards",
  "price": 45000,
  "currency": "SATS",
  "totalCost": 47000,
  "shippingType": "Added Cost",
  "shippingCost": 2000,
  "images": ["https://…"],
  "categories": ["leather", "accessories"],
  …
}
------------------------------------------------------------

--- Field Presence Report ---
Total events parsed: 10

  images              9/10   90%  ██████████████████
  categories          8/10   80%  ████████████████
  d                   8/10   80%  ████████████████
  shippingType        6/10   60%  ████████████
  summary             6/10   60%  ████████████
  shippingCost        5/10   50%  ██████████
  …
```

### Implementation notes

- Uses `nostr-tools` `SimplePool.subscribeMap()` (v2 API), mirroring `NostrManager.subscribe()`.
- Verifies each event signature with `verifyEvent()` before accepting it.
- Closes the subscription on `EOSE` or after a 15 s timeout, whichever comes first.
- `sizeQuantities`, `volumePrices`, `weightPrices`, and `bulk` are serialised as plain objects (instead of `Map`) so `JSON.stringify` works without a replacer.

---

## Task 2 — ProductData field availability on live listings

Fields are classed into four tiers based on NIP-99 requirements and observed relay data.

### Always present

These fields are guaranteed on every well-formed kind 30402 event.

| Field       | Source tag                    | Notes                         |
| ----------- | ----------------------------- | ----------------------------- |
| `id`        | `event.id`                    | Nostr protocol field          |
| `pubkey`    | `event.pubkey`                | Nostr protocol field          |
| `createdAt` | `event.created_at`            | Unix timestamp                |
| `title`     | `["title", …]`                | Required by NIP-99            |
| `price`     | `["price", amount, currency]` | Required by NIP-99            |
| `currency`  | `["price", …, currency]`      | Co-located with price         |
| `totalCost` | derived                       | `price + (shippingCost ?? 0)` |

### Common (present on most listings)

| Field          | Source tag                           | Notes                                         |
| -------------- | ------------------------------------ | --------------------------------------------- |
| `summary`      | `["summary", …]`                     | Short description                             |
| `images`       | `["image", url]` (repeatable)        | At least one image per listing is typical     |
| `categories`   | `["t", tag]` (repeatable)            | Hashtag-style categories                      |
| `d`            | `["d", identifier]`                  | Required for parameterised replaceable events |
| `shippingType` | `["shipping", type, cost, currency]` | One of the five valid types                   |

### Inconsistent (present on some listings)

| Field          | Source tag                 | Notes                                   |
| -------------- | -------------------------- | --------------------------------------- |
| `publishedAt`  | `["published_at", unix]`   | Older clients omit this                 |
| `location`     | `["location", …]`          | Physical or regional string             |
| `shippingCost` | `["shipping", …, cost, …]` | Absent when type is `"Free"` or `"N/A"` |
| `status`       | `["status", …]`            | e.g. `"active"`                         |
| `condition`    | `["condition", …]`         | e.g. `"new"`, `"used"`                  |

### Rarely set (niche / category-specific)

| Field                      | Source tag                                         | Notes                      |
| -------------------------- | -------------------------------------------------- | -------------------------- |
| `quantity`                 | `["quantity", n]`                                  | Stock count                |
| `sizes` / `sizeQuantities` | `["size", label, qty]`                             | Clothing items             |
| `volumes` / `volumePrices` | `["volume", label, price]`                         | Beverages / bulk           |
| `weights` / `weightPrices` | `["weight", label, price]`                         | Sold-by-weight items       |
| `bulkPrices`               | `["bulk", units, price]`                           | Tiered bulk pricing        |
| `pickupLocations`          | `["pickup_location", …]`                           | Local pickup only          |
| `contentWarning`           | `["content-warning"]` or `["L","content-warning"]` | Sensitive content flag     |
| `expiration`               | `["valid_until", unix]`                            | Time-limited listings      |
| `required`                 | `["required", …]`                                  | Mandatory buyer fields     |
| `restrictions`             | `["restrictions", …]`                              | Geographic or other limits |

### Shipping tag format

`parseShippingTag` only accepts the modern **4-element** format:

```
["shipping", type, cost, currency]
```

Legacy 1- and 2-element tags are silently ignored. Valid `shippingType` values (from [`utils/STATIC-VARIABLES.ts`](utils/STATIC-VARIABLES.ts)):

```
"N/A" | "Free" | "Pickup" | "Free/Pickup" | "Added Cost"
```

---

## Task 3 — NIP-99 read path: developer reference

### Overview

Shopstr implements [NIP-99 Classified Listings](https://github.com/nostr-protocol/nips/blob/master/99.md) using Nostr **kind 30402** (parameterised replaceable event). Every product is a signed Nostr event whose tags encode all structured listing data. The read path converts raw relay events into typed `ProductData` objects consumed by React contexts and MCP read tools.

### Canonical file locations

| Concern                            | File                                                                                     | Key export                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| `ProductData` type + `parseTags()` | [`utils/parsers/product-parser-functions.ts`](utils/parsers/product-parser-functions.ts) | `parseTags(event)`         |
| Shipping tag parsing               | [`utils/parsers/product-tag-helpers.ts`](utils/parsers/product-tag-helpers.ts)           | `parseShippingTag(tag)`    |
| Relay subscription wrapper         | [`utils/nostr/nostr-manager.ts`](utils/nostr/nostr-manager.ts)                           | `NostrManager.fetch()`     |
| Live relay fetch + DB cache        | [`utils/nostr/fetch-service.ts`](utils/nostr/fetch-service.ts)                           | `fetchAllPosts()`          |
| Default relay list                 | [`utils/nostr/nostr-helper-functions.ts`](utils/nostr/nostr-helper-functions.ts)         | `getDefaultRelays()`       |
| DB read (cached path)              | [`utils/db/db-service.ts`](utils/db/db-service.ts)                                       | `fetchAllProductsFromDb()` |

### Data flow

```
Relay (kind 30402 events)
        │
        ▼
NostrManager.fetch()              ← wraps nostr-tools SimplePool
        │                            filter: { kinds: [30402] }
        ▼
parseTags(event)                  ← maps raw Nostr tags → ProductData
        │
        ├──▶ parseShippingTag()   handles ["shipping", type, cost, currency]
        └──▶ totalCost = price + (shippingCost ?? 0)
        │
        ▼
ProductData                       ← consumed by React contexts + MCP read tools
```

### Production cascade fetch (`fetchAllPosts`)

In production the app uses a three-step cascade:

1. **DB cache** — pull cached events from PostgreSQL in 500-event batches (fast path, avoids relay round-trips).
2. **Live relay** — fall back to direct relay queries if the DB is cold or the cache is stale.
3. **Write-back** — relay events are written back to the DB via `cacheEventsToDatabase()` for future requests.

```
fetchAllPosts()
  │
  ├─1─▶ fetchAllProductsFromDb()     PostgreSQL (fast)
  │         hit ──▶ return products
  │
  ├─2─▶ NostrManager.fetch()         Relay query (fallback)
  │
  └─3─▶ cacheEventsToDatabase()      Write-back
```

### Extending the parser

To add a new NIP-99 tag:

1. Add the field to the `ProductData` type in [`utils/parsers/product-parser-functions.ts`](utils/parsers/product-parser-functions.ts).
2. Add a `case "your-tag":` branch inside `parseTags()` in the same file.
3. Mirror the case in the standalone script [`scripts/fetch-products.mjs`](scripts/fetch-products.mjs) if you want it in the field-presence report.

### Running the standalone script

```bash
node scripts/fetch-products.mjs                        # 10 events from wss://relay.damus.io
node scripts/fetch-products.mjs wss://nos.lol 25       # 25 events from nos.lol
```
