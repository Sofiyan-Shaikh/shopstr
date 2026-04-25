/**
 * Standalone script: fetch kind 30402 (NIP-99 classified listings) from a
 * public Nostr relay and print each one as a parsed ProductData object.
 *
 * No Next.js, no React, no path aliases required.
 *
 * Usage:
 *   node scripts/fetch-products.mjs
 *   node scripts/fetch-products.mjs wss://relay.damus.io 20
 *
 * Arguments (positional, both optional):
 *   $1  Relay WebSocket URL  (default: wss://relay.damus.io)
 *   $2  Max events to fetch  (default: 10)
 *
 * Requires: nostr-tools (already in project dependencies)
 */

import { SimplePool } from "nostr-tools/pool";
import { verifyEvent } from "nostr-tools/pure";

// ---------------------------------------------------------------------------
// Shipping helpers — inlined from utils/parsers/product-tag-helpers.ts
// ---------------------------------------------------------------------------

const SHIPPING_OPTIONS = ["N/A", "Free", "Pickup", "Free/Pickup", "Added Cost"];

function parseShippingTag(tag) {
  // Only the modern 4-element format ["shipping", type, cost, currency]
  if (!tag || tag[0] !== "shipping" || tag.length !== 4) return undefined;

  const [, shippingType, rawShippingCost, shippingCurrency] = tag;

  if (
    !shippingType ||
    !shippingCurrency ||
    !SHIPPING_OPTIONS.includes(shippingType)
  )
    return undefined;

  if (rawShippingCost == null || !String(rawShippingCost).trim())
    return undefined;

  const shippingCost = Number(rawShippingCost);
  if (!Number.isFinite(shippingCost) || shippingCost < 0) return undefined;

  return { shippingType, shippingCost };
}

// ---------------------------------------------------------------------------
// parseTags — mirrors utils/parsers/product-parser-functions.ts
// Map keys are serialised to plain objects for JSON.stringify compatibility.
// ---------------------------------------------------------------------------

function parseTags(event) {
  const data = {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    title: "",
    summary: "",
    publishedAt: "",
    images: [],
    categories: [],
    location: "",
    price: 0,
    currency: "",
    shippingType: undefined,
    shippingCost: undefined,
    totalCost: 0,
    d: undefined,
    contentWarning: undefined,
    quantity: undefined,
    sizes: undefined,
    sizeQuantities: undefined, // Map<string, number> → plain object below
    volumes: undefined,
    volumePrices: undefined,
    weights: undefined,
    weightPrices: undefined,
    condition: undefined,
    status: undefined,
    required: undefined,
    restrictions: undefined,
    pickupLocations: undefined,
    expiration: undefined,
    bulkPrices: undefined, // Map<number, number> → plain object below
  };

  const tags = event.tags;
  if (!tags) return data;

  for (const tag of tags) {
    const [key, ...values] = tag;
    switch (key) {
      case "title":
        data.title = values[0] ?? "";
        break;
      case "summary":
        data.summary = values[0] ?? "";
        break;
      case "published_at":
        data.publishedAt = values[0] ?? "";
        break;
      case "image":
        data.images.push(values[0]);
        break;
      case "t":
        data.categories.push(values[0]);
        break;
      case "location":
        data.location = values[0] ?? "";
        break;
      case "d":
        data.d = values[0];
        break;
      case "condition":
        data.condition = values[0];
        break;
      case "status":
        data.status = values[0];
        break;
      case "required":
        data.required = values[0];
        break;
      case "restrictions":
        data.restrictions = values[0];
        break;
      case "valid_until":
        data.expiration = Number(values[0]);
        break;

      case "price": {
        const [amount, currency] = values;
        data.price = Number(amount);
        data.currency = currency ?? "";
        break;
      }

      case "shipping": {
        const parsed = parseShippingTag(tag);
        if (parsed) {
          data.shippingType = parsed.shippingType;
          data.shippingCost = parsed.shippingCost;
        }
        break;
      }

      case "content-warning":
        data.contentWarning = true;
        break;

      case "L":
        if (values[0] === "content-warning") data.contentWarning = true;
        break;

      case "l":
        if (values[1] === "content-warning") data.contentWarning = true;
        break;

      case "quantity":
        data.quantity = Number(values[0]);
        break;

      case "size": {
        const [size, qty] = values;
        if (!data.sizes) {
          data.sizes = [];
          data.sizeQuantities = {};
        }
        data.sizes.push(size);
        data.sizeQuantities[size] = Number(qty);
        break;
      }

      case "volume": {
        if (!data.volumes) {
          data.volumes = [];
          data.volumePrices = {};
        }
        if (values[0]) {
          data.volumes.push(values[0]);
          if (values[1]) data.volumePrices[values[0]] = parseFloat(values[1]);
        }
        break;
      }

      case "weight": {
        if (!data.weights) {
          data.weights = [];
          data.weightPrices = {};
        }
        if (values[0]) {
          data.weights.push(values[0]);
          if (values[1]) data.weightPrices[values[0]] = parseFloat(values[1]);
        }
        break;
      }

      case "bulk": {
        if (!data.bulkPrices) data.bulkPrices = {};
        if (values[0] && values[1]) {
          data.bulkPrices[parseInt(values[0])] = parseFloat(values[1]);
        }
        break;
      }

      case "pickup_location": {
        if (!data.pickupLocations) data.pickupLocations = [];
        data.pickupLocations.push(values[0]);
        break;
      }

      default:
        break;
    }
  }

  data.totalCost = data.price + (data.shippingCost ?? 0);
  return data;
}

// ---------------------------------------------------------------------------
// Minimal relay fetch — mirrors the core of NostrManager.fetch()
// ---------------------------------------------------------------------------

function fetchProducts(relayUrl, limit) {
  const pool = new SimplePool();
  const events = [];

  // nostr-tools v2 uses pool.subscribeMap({ url, filter }[]) — mirrors NostrManager.subscribe()
  const requests = [{ url: relayUrl, filter: { kinds: [30402], limit } }];

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      sub.close();
      pool.close([relayUrl]);
      resolve(events);
    };

    const timeout = setTimeout(done, 15_000);

    const sub = pool.subscribeMap(requests, {
      onevent(event) {
        if (verifyEvent(event)) {
          events.push(event);
          if (events.length >= limit) done();
        }
      },
      oneose: done,
    });
  });
}

// ---------------------------------------------------------------------------
// Field presence reporter
// ---------------------------------------------------------------------------

function fieldPresenceReport(products) {
  const optional = [
    "publishedAt",
    "images",
    "categories",
    "location",
    "shippingType",
    "shippingCost",
    "d",
    "contentWarning",
    "quantity",
    "sizes",
    "volumes",
    "weights",
    "condition",
    "status",
    "required",
    "restrictions",
    "pickupLocations",
    "expiration",
    "bulkPrices",
  ];

  const counts = {};
  for (const f of optional) counts[f] = 0;

  for (const p of products) {
    for (const f of optional) {
      const v = p[f];
      if (
        v !== undefined &&
        v !== null &&
        v !== "" &&
        !(Array.isArray(v) && v.length === 0)
      ) {
        counts[f]++;
      }
    }
  }

  const total = products.length;
  console.log("\n--- Field Presence Report ---");
  console.log(`Total events parsed: ${total}\n`);

  const rows = optional
    .map((f) => ({
      field: f,
      pct: total ? ((counts[f] / total) * 100).toFixed(0) : 0,
      n: counts[f],
    }))
    .sort((a, b) => b.n - a.n);

  for (const { field, pct, n } of rows) {
    const bar = "█".repeat(Math.round(Number(pct) / 5));
    console.log(
      `  ${field.padEnd(18)} ${String(n).padStart(3)}/${total}  ${String(pct).padStart(3)}%  ${bar}`
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const relayUrl = process.argv[2] ?? "wss://relay.damus.io";
const limit = parseInt(process.argv[3] ?? "10", 10);

console.log(
  `Connecting to ${relayUrl}, requesting up to ${limit} kind:30402 events…\n`
);

const rawEvents = await fetchProducts(relayUrl, limit);

if (rawEvents.length === 0) {
  console.log(
    "No events returned. The relay may be offline or have no kind:30402 listings."
  );
  process.exit(0);
}

console.log(`Received ${rawEvents.length} events. Parsing…\n`);
console.log("=".repeat(60));

const products = [];
for (const event of rawEvents) {
  const product = parseTags(event);
  products.push(product);
  console.log(JSON.stringify(product, null, 2));
  console.log("-".repeat(60));
}

fieldPresenceReport(products);
