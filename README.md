# Shopstr

A global, permissionless Nostr marketplace for Bitcoin commerce.

# Supported NIPs

- [x] NIP-02: Follow List
- [x] NIP-05: Mapping Nostr keys to DNS-based internet identifiers
- [x] NIP-07: window.nostr capability for web browsers
- [x] NIP-09: Event Deletion
- [x] NIP-17: Private Direct Messages
- [x] NIP-19: bech32-encoded entities
- [x] NIP-24: Extra metadata fields and tags
- [x] NIP-31: Dealing with Unknown Events
- [x] NIP-36: Sensitive Content
- [x] NIP-40: Expiration Timestamp
- [ ] NIP-42: Authentication of clients to relays
- [x] NIP-46: Nostr Remote Signing
- [x] NIP-47: Wallet Connect
- [x] NIP-49: Private Key Encryption
- [ ] NIP-50: Search Capability
- [x] NIP-51: Lists
- [ ] NIP-56: Reporting
- [x] NIP-57: Lightning Zaps
- [ ] NIP-58: Badges
- [x] NIP-60: Cashu Wallet
- [ ] NIP-61: Nutzaps
- [x] NIP-65: Relay List Metadata
- [x] NIP-72: Moderated Communities
- [x] NIP-85: Reviews
- [x] NIP-89: Recommended Application Handlers
- [x] NIP-98: HTTP Auth
- [x] NIP-99: Classified Listings
- [x] NIP-B7: Blossom Media

# NIP-99 Read Path — Developer Reference

## What is NIP-99?

[NIP-99](https://github.com/nostr-protocol/nips/blob/master/99.md) is the Nostr protocol specification for **classified listings** — the mechanism Shopstr uses to publish and discover products. Every product on Shopstr is a signed Nostr event of **kind 30402** (a parameterised replaceable event). All structured product data — title, price, images, shipping, categories — is encoded in the event's `tags` array rather than in the event body. The event body (`content`) is reserved for a long-form description.

A minimal kind 30402 event looks like this:

```json
{
  "kind": 30402,
  "pubkey": "<seller pubkey>",
  "created_at": 1713800000,
  "tags": [
    ["d", "my-leather-wallet"],
    ["title", "Handmade Leather Wallet"],
    ["summary", "Genuine cowhide, fits 8 cards"],
    ["price", "45000", "SATS"],
    ["shipping", "Added Cost", "2000", "SATS"],
    ["image", "https://example.com/wallet.jpg"],
    ["t", "leather"],
    ["t", "accessories"]
  ],
  "content": "Full product description goes here.",
  "id": "<event id>",
  "sig": "<schnorr signature>"
}
```

The read path's job is to convert this raw event into a typed `ProductData` object that the rest of the app can consume without touching Nostr internals.

---

## Canonical file locations

| Concern                            | File                                                                                     | Key export                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| `ProductData` type + `parseTags()` | [`utils/parsers/product-parser-functions.ts`](utils/parsers/product-parser-functions.ts) | `parseTags(event)`         |
| Shipping tag parsing               | [`utils/parsers/product-tag-helpers.ts`](utils/parsers/product-tag-helpers.ts)           | `parseShippingTag(tag)`    |
| Relay subscription wrapper         | [`utils/nostr/nostr-manager.ts`](utils/nostr/nostr-manager.ts)                           | `NostrManager.fetch()`     |
| Live relay fetch + DB cache        | [`utils/nostr/fetch-service.ts`](utils/nostr/fetch-service.ts)                           | `fetchAllPosts()`          |
| Default relay list                 | [`utils/nostr/nostr-helper-functions.ts`](utils/nostr/nostr-helper-functions.ts)         | `getDefaultRelays()`       |
| DB read (cached path)              | [`utils/db/db-service.ts`](utils/db/db-service.ts)                                       | `fetchAllProductsFromDb()` |
| Standalone exploration script      | [`scripts/fetch-products.mjs`](scripts/fetch-products.mjs)                               | —                          |

---

## End-to-end data flow

```
Public Nostr Relay
  (kind 30402 events over WebSocket)
        │
        ▼
NostrManager.fetch(filters, params, relayUrls)
  ├── wraps nostr-tools SimplePool
  ├── opens a subscription: { kinds: [30402], limit, ...filters }
  ├── collects events via onevent callback
  └── resolves on EOSE (End Of Stored Events) or timeout
        │
        ▼
parseTags(event)                     [product-parser-functions.ts]
  ├── reads event.id, event.pubkey, event.created_at
  ├── iterates event.tags — one switch/case per tag key:
  │     "title", "summary", "published_at", "image", "t",
  │     "location", "price", "d", "condition", "status",
  │     "required", "restrictions", "valid_until",
  │     "quantity", "size", "volume", "weight", "bulk",
  │     "pickup_location", "content-warning", "L", "l"
  │
  ├──▶ parseShippingTag(tag)          [product-tag-helpers.ts]
  │       accepts only the modern 4-element format:
  │       ["shipping", type, cost, currency]
  │       validates type against SHIPPING_OPTIONS allowlist
  │       returns { shippingType, shippingCost } or undefined
  │
  └──▶ calculateTotalCost(parsedData)
          totalCost = price + (shippingCost ?? 0)
        │
        ▼
ProductData object
  (typed, relay-agnostic, consumed by React contexts + MCP read tools)
```

### Production cascade fetch (`fetchAllPosts`)

In production the app does not always hit a relay directly. [`fetchAllPosts`](utils/nostr/fetch-service.ts) runs a three-step cascade:

```
fetchAllPosts()
  │
  ├─ Step 1 ──▶ fetchAllProductsFromDb()
  │               PostgreSQL, pulled in 500-event batches
  │               If rows exist → return immediately (fast path)
  │
  ├─ Step 2 ──▶ NostrManager.fetch()
  │               Live relay query — only runs if DB is cold or empty
  │
  └─ Step 3 ──▶ cacheEventsToDatabase()
                  Writes relay events back to PostgreSQL
                  so the next request hits Step 1 instead
```

This means most page loads never touch a relay; they read from Postgres. The relay is only queried when the cache is cold (first boot, cache cleared, or new relay added).

---

## `parseTags()` in detail

`parseTags()` in [`utils/parsers/product-parser-functions.ts`](utils/parsers/product-parser-functions.ts) is the single source of truth for converting a raw Nostr event into a `ProductData` object. It initialises all fields to safe defaults, then walks the `tags` array and fills fields in via a `switch` statement.

### Field initialisation defaults

Before any tag is read, `parseTags` sets these defaults so downstream code never has to guard against `undefined` on core fields:

```ts
{
  id: "",  pubkey: "",  createdAt: 0,
  title: "",  summary: "",  publishedAt: "",
  images: [],  categories: [],  location: "",
  price: 0,  currency: "",  totalCost: 0,
  rawEvent: productEvent,   // reference to the original event
}
```

All optional fields (`shippingType`, `shippingCost`, `quantity`, `sizes`, etc.) start as `undefined` and are only set if the corresponding tag is present.

### Tag-by-tag breakdown

| Tag key           | Maps to                        | Notes                                                                                      |
| ----------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `title`           | `title`                        | Plain string                                                                               |
| `summary`         | `summary`                      | Short description shown in listings                                                        |
| `published_at`    | `publishedAt`                  | Unix timestamp as string (older clients omit)                                              |
| `image`           | `images[]`                     | Repeatable — each tag adds one URL to the array                                            |
| `t`               | `categories[]`                 | Repeatable hashtag — each tag adds one category                                            |
| `location`        | `location`                     | Physical or regional string                                                                |
| `d`               | `d`                            | Unique identifier; required for parameterised replaceable events                           |
| `price`           | `price`, `currency`            | `["price", amount, currency]` — amount parsed as `Number`                                  |
| `shipping`        | `shippingType`, `shippingCost` | Delegated to `parseShippingTag()` — see below                                              |
| `content-warning` | `contentWarning = true`        | Three equivalent forms: bare tag, `["L","content-warning"]`, `["l", …, "content-warning"]` |
| `quantity`        | `quantity`                     | Stock count as `Number`                                                                    |
| `size`            | `sizes[]`, `sizeQuantities{}`  | `["size", label, qty]` — label goes into array, qty keyed by label in map                  |
| `volume`          | `volumes[]`, `volumePrices{}`  | Same pattern as size, for beverages or bulk                                                |
| `weight`          | `weights[]`, `weightPrices{}`  | Same pattern, for sold-by-weight items                                                     |
| `bulk`            | `bulkPrices{}`                 | `["bulk", units, price]` — tiered bulk pricing map                                         |
| `pickup_location` | `pickupLocations[]`            | Repeatable — each tag adds one location string                                             |
| `valid_until`     | `expiration`                   | Unix timestamp as `Number`                                                                 |
| `condition`       | `condition`                    | e.g. `"new"`, `"used"`, `"refurbished"`                                                    |
| `status`          | `status`                       | e.g. `"active"`, `"sold"`                                                                  |
| `required`        | `required`                     | Mandatory buyer-provided fields                                                            |
| `restrictions`    | `restrictions`                 | Geographic or legal restrictions                                                           |

After all tags are processed, `totalCost = price + (shippingCost ?? 0)` is computed and stored.

---

## `parseShippingTag()` in detail

Defined in [`utils/parsers/product-tag-helpers.ts`](utils/parsers/product-tag-helpers.ts). It deliberately accepts **only** the modern 4-element format and silently ignores anything else:

```
["shipping", type, cost, currency]
```

Validation steps (all must pass, otherwise returns `undefined`):

1. Tag must have exactly 4 elements.
2. `type` must be one of the five values in `SHIPPING_OPTIONS` (defined in [`utils/STATIC-VARIABLES.ts`](utils/STATIC-VARIABLES.ts)):
   ```
   "N/A" | "Free" | "Pickup" | "Free/Pickup" | "Added Cost"
   ```
3. `currency` must be a non-empty string.
4. `cost` must be a non-empty string that converts to a finite, non-negative number.

If all four checks pass, it returns `{ shippingType, shippingCost }`. The parent `parseTags()` assigns both fields to `ProductData`.

> Legacy 1- and 2-element shipping tags found on older Shopstr listings are intentionally rejected. If a product event contains both a legacy and a modern shipping tag, `parseShippingFromTags()` (also in that file) applies a "last valid wins" rule so the modern tag takes precedence.

---

## `NostrManager` in detail

[`utils/nostr/nostr-manager.ts`](utils/nostr/nostr-manager.ts) wraps the `nostr-tools` `SimplePool` to give the rest of the app a typed, relay-aware interface.

**`NostrManager.subscribe(filters, params, relayUrls?)`**
Opens a live subscription using `pool.subscribeMap()`. Merges per-relay relay URLs from the manager's internal list (or the provided override) with the filters, then passes `onevent` / `oneose` callbacks through. Returns a subscription handle with a `.close()` method.

**`NostrManager.fetch(filters, params?, relayUrls?)`**
Wraps `subscribe()` in a promise. Collects all events arriving before EOSE into an array and resolves with that array when the relay sends EOSE. Uses `newPromiseWithTimeout` so a stalled relay cannot hang the caller indefinitely.

**`NostrManager.publish(event, relayUrls?)`**
Writes a signed event to all writable relays. Throws if the manager was created without `writable: true`.

---

## ProductData field availability on live listings

Based on the NIP-99 specification and observation of live kind 30402 events on public relays, fields fall into four tiers:

### Always present

These are guaranteed on every valid kind 30402 event. Any well-formed client must set them; relays will not store events that fail signature verification or are missing protocol-level fields.

| Field       | Source                        | Why always present                                                  |
| ----------- | ----------------------------- | ------------------------------------------------------------------- |
| `id`        | `event.id`                    | Nostr protocol field — computed from event content                  |
| `pubkey`    | `event.pubkey`                | Nostr protocol field — seller's public key                          |
| `createdAt` | `event.created_at`            | Nostr protocol field — Unix timestamp                               |
| `title`     | `["title", …]`                | Required by NIP-99                                                  |
| `price`     | `["price", amount, currency]` | Required by NIP-99                                                  |
| `currency`  | co-located with price         | Required by NIP-99, parsed from same tag                            |
| `totalCost` | derived                       | Computed as `price + (shippingCost ?? 0)` — always at least `price` |

### Common (present on most listings)

Not mandated by the NIP but nearly universal in practice because well-maintained clients set them by default.

| Field          | Source tag                           | Notes                                                                                                               |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `summary`      | `["summary", …]`                     | Short description shown in search results and cards                                                                 |
| `images`       | `["image", url]`                     | At least one image is standard practice; some have several                                                          |
| `categories`   | `["t", tag]`                         | Hashtag categories — used for filtering and discovery                                                               |
| `d`            | `["d", identifier]`                  | Required for parameterised replaceable events (kind 30402 is one) — without it the event cannot be updated in place |
| `shippingType` | `["shipping", type, cost, currency]` | One of the five valid values; absent only on local/pickup-only listings                                             |

### Inconsistent (present on some listings)

Set by some clients or some sellers, omitted by others. Code that reads these fields should always check for `undefined`.

| Field          | Source tag               | Why inconsistent                                                                 |
| -------------- | ------------------------ | -------------------------------------------------------------------------------- |
| `publishedAt`  | `["published_at", unix]` | Older clients and custom publishers do not set this                              |
| `location`     | `["location", …]`        | Sellers of digital goods rarely set a location                                   |
| `shippingCost` | from shipping tag        | Absent when `shippingType` is `"Free"`, `"N/A"`, or `"Pickup"` (no cost applies) |
| `status`       | `["status", …]`          | Some clients track `"active"` / `"sold"` status; many do not                     |
| `condition`    | `["condition", …]`       | Relevant for physical goods; typically absent on digital items                   |

### Rarely set (niche or category-specific)

These fields exist in the schema to handle specific product categories or advanced seller needs. Expect them to be `undefined` in the vast majority of listings.

| Field                      | Source tag                                         | Use case                                                     |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `quantity`                 | `["quantity", n]`                                  | Stock count — most sellers do not track inventory on-chain   |
| `sizes` / `sizeQuantities` | `["size", label, qty]`                             | Clothing — label like `"M"`, qty per size                    |
| `volumes` / `volumePrices` | `["volume", label, price]`                         | Beverages or liquid goods sold in multiple sizes             |
| `weights` / `weightPrices` | `["weight", label, price]`                         | Goods sold by weight (coffee, spices, etc.)                  |
| `bulkPrices`               | `["bulk", units, price]`                           | Tiered pricing — price per unit drops at higher quantities   |
| `pickupLocations`          | `["pickup_location", …]`                           | Local-pickup listings only                                   |
| `contentWarning`           | `["content-warning"]` or `["L","content-warning"]` | Sensitive content flag — rare but handled in three tag forms |
| `expiration`               | `["valid_until", unix]`                            | Time-limited offers, flash sales                             |
| `required`                 | `["required", …]`                                  | Fields the buyer must fill in before purchase                |
| `restrictions`             | `["restrictions", …]`                              | Geographic or legal limits on who can buy                    |

---

## Standalone fetch script

[`scripts/fetch-products.mjs`](scripts/fetch-products.mjs) is a **self-contained Node.js script** for exploring and debugging live kind 30402 listings. It has zero Next.js, React, or path-alias dependencies and runs with plain `node`.

### What it inlines from production

The script cannot import from the app's TypeScript source directly (no build step, no path aliases). Instead it inlines the two parser functions verbatim:

| Production source                                             | Inlined as                                    |
| ------------------------------------------------------------- | --------------------------------------------- |
| `utils/parsers/product-tag-helpers.ts` → `parseShippingTag()` | `parseShippingTag()` in script                |
| `utils/parsers/product-parser-functions.ts` → `parseTags()`   | `parseTags()` in script                       |
| `utils/nostr/nostr-manager.ts` → `NostrManager.fetch()`       | `fetchProducts()` using `SimplePool` directly |

One intentional difference from the TypeScript source: `Map<string, number>` and `Map<number, number>` fields (`sizeQuantities`, `volumePrices`, `weightPrices`, `bulkPrices`) are stored as plain objects so that `JSON.stringify` works without a custom replacer.

### How `fetchProducts()` mirrors `NostrManager`

```js
// Script                              // NostrManager equivalent
const pool = new SimplePool();         // this.pool = new SimplePool()
pool.subscribeMap([                    // pool.subscribeMap(requests, params)
  { url: relayUrl,
    filter: { kinds: [30402], limit } }
], {
  onevent(event) {                     // params.onevent
    if (verifyEvent(event)) { … }      // signature check before accepting
  },
  oneose: done,                        // params.oneose → sub.close() + resolve
});
setTimeout(done, 15_000);             // newPromiseWithTimeout equivalent
```

`verifyEvent()` (from `nostr-tools`) validates the Schnorr signature on every received event before accepting it — the script will not print a `ProductData` for a forged event.

### Field presence report

After printing every parsed `ProductData`, the script prints a summary showing how many of the fetched events had each optional field populated:

```
--- Field Presence Report ---
Total events parsed: 10

  images              9/10   90%  ██████████████████
  categories          8/10   80%  ████████████████
  d                   8/10   80%  ████████████████
  shippingType        6/10   60%  ████████████
  summary             6/10   60%  ████████████
  shippingCost        5/10   50%  ██████████
  publishedAt         3/10   30%  ██████
  condition           1/10   10%  ██
  quantity            0/10    0%
  …
```

This makes it easy to see at a glance which fields are reliable enough to depend on and which need defensive `?? fallback` handling.

### Usage

```bash
# Install dependencies (nostr-tools is already in package.json)
npm install

# Fetch 10 listings from the default relay (wss://relay.damus.io)
node scripts/fetch-products.mjs

# Custom relay
node scripts/fetch-products.mjs wss://nos.lol

# Custom relay and event limit
node scripts/fetch-products.mjs wss://nos.lol 25
node scripts/fetch-products.mjs wss://relay.damus.io 50
```

### Extending the parser

To add support for a new NIP-99 tag across the whole stack:

1. Add the field to `ProductData` in [`utils/parsers/product-parser-functions.ts`](utils/parsers/product-parser-functions.ts).
2. Add a `case "your-tag":` branch inside `parseTags()` in the same file.
3. Add the same case to `parseTags()` in [`scripts/fetch-products.mjs`](scripts/fetch-products.mjs) and add the field name to the `optional` array in `fieldPresenceReport()` if you want it tracked in the report.

# Authors

- [calvadev](nostr:npub16dhgpql60vmd4mnydjut87vla23a38j689jssaqlqqlzrtqtd0kqex0nkq)
  - npub16dhgpql60vmd4mnydjut87vla23a38j689jssaqlqqlzrtqtd0kqex0nkq
- [thomasyeung687](nostr:npub14u43en9xrzh92lmy8yk6fq3mme7vyul7x66n2zl6y35c3nt3y0lqhs3g74)
  - npub14u43en9xrzh92lmy8yk6fq3mme7vyul7x66n2zl6y35c3nt3y0lqhs3g74
- [ericspaghetti](nostr:npub1qxda7stfxfauufa4mkgqj2lur0jdpxlpnqhqdctwl2t6akuruw3qjdkkn0)
  - npub1qxda7stfxfauufa4mkgqj2lur0jdpxlpnqhqdctwl2t6akuruw3qjdkkn0

[![Run on Repl.it](https://replit.com/badge/github/calvadev/shopstr)](https://replit.com/new/github/calvadev/shopstr)
