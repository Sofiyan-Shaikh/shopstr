# Shopstr — Summer of Bitcoin Competency Test

**Applicant:** Sofiyan Shaikh  
**Email:** sofiyanshaikh0007@gmail.com  
**Project:** Shopstr — NIP-50 Search & NIP-56 Reporting

---

## Task 1 — Isolated listing search predicate with tests

**Files:**
[`utils/parsers/listing-search-predicate.ts`](utils/parsers/listing-search-predicate.ts) · [`utils/parsers/__tests__/listing-search-predicate.test.ts`](utils/parsers/__tests__/listing-search-predicate.test.ts)

The existing client-side search logic was extracted from `product-filter-helpers.ts` into a standalone, dependency-free module so it can be run over both local events and raw relay events and the two sets compared. `product-filter-helpers.ts` now delegates to it — **no call-site changes required**.

### What was extracted and why

| Production source                                    | Extracted as                                                                  | Reason                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Inline predicate in `productSatisfiesSearchFilter()` | `parseListingSearchQuery()` + `matchesListingSearch()`                        | Decouples query classification from evaluation so each can be tested independently |
| `ProductData` input type                             | `SearchableListing` (narrow type: `pubkey`, `d`, `title`, `summary`, `price`) | Removes parser-stack dependency so the predicate runs on raw relay events          |
| Single string-in, bool-out interface                 | `listingMatchesSearchString()` convenience wrapper                            | Drop-in replacement for the old `productSatisfiesSearchFilter`                     |

### How the predicate works

`parseListingSearchQuery(rawQuery)` classifies any raw search string into one of four shapes **before** touching listing data:

| Query kind | Trigger                        | Evaluation                                                                    |
| ---------- | ------------------------------ | ----------------------------------------------------------------------------- |
| `empty`    | Blank or whitespace-only input | Every listing passes                                                          |
| `naddr`    | Valid bech32 `naddr1…` string  | Exact match on `pubkey` + `d` identifier                                      |
| `npub`     | Valid bech32 `npub1…` string   | Exact match on `pubkey`                                                       |
| `text`     | Everything else                | Case-insensitive substring on `title`/`summary`; optional exact numeric price |

Malformed bech32 strings fall through to `text` (preserving prior behaviour). All regex metacharacters are escaped before the `RegExp` is built, so a search for `(v2)` matches the literal substring, not a capture group.

### Usage

```bash
# Run the test suite
npx jest --testPathPatterns="listing-search-predicate"
```

### What the output looks like

```
PASS utils/parsers/__tests__/listing-search-predicate.test.ts
  parseListingSearchQuery
    ✓ returns `empty` for blank / whitespace-only input
    ✓ decodes a valid naddr into its components
    ✓ decodes a valid npub into its pubkey
    ✓ falls back to text when a `naddr1`/`npub1` token fails to decode
    ✓ captures a numeric interpretation for price matching
    ✓ trims surrounding whitespace before classifying
  matchesListingSearch
    ✓ matches everything for an empty query
    naddr address lookup
      ✓ matches only when pubkey AND d identifier both match
      ✓ rejects when pubkey matches but identifier differs
      ✓ rejects when identifier matches but pubkey differs
    npub address lookup
      ✓ matches only when pubkeys are equal
    text matching
      ✓ matches substrings in title (case-insensitive)
      ✓ matches substrings in summary when title does not match
      ✓ returns false when the listing has no title
      ✓ matches exact numeric price
      ✓ does not match price when `numeric` is null
      ✓ safely handles regex metacharacters
  listingMatchesSearchString (integration)
    ✓ is the identity for whitespace-only queries
    ✓ matches on text
    ✓ matches on exact numeric price
    ✓ matches on a real naddr when pubkey + identifier align
    ✓ matches on a real npub that equals the listing pubkey
    ✓ does not crash on malformed bech32

Tests: 27 passed, 27 total
```

### Implementation notes

- `SearchableListing` is intentionally narrower than `ProductData` so the predicate can be called on raw relay events without running the full parser stack — this is what allows side-by-side comparison with NIP-50 relay results.
- The `text` branch is deliberately narrow (title + summary substring + exact price) because that is the surface NIP-50 is expected to cover; when the relay-backed flow lands, any drift between "relay matched" and "local predicate matched" is measured against exactly this implementation.
- `naddr` / `npub` queries are pure address lookups and must never be sent as NIP-50 `search` filters — they bypass the relay round-trip entirely.

---

## Task 2 — NIP-50 relay evaluation note

**File:** [`docs/nip50-relay-evaluation.md`](docs/nip50-relay-evaluation.md)

A short written note evaluating all six relays Shopstr configures by default — from `getDefaultRelays()` and `withBlastr()` in `utils/nostr/nostr-helper-functions.ts` — against five explicit NIP-50 criteria, concluding with a concrete integration plan.

### Evaluation criteria

A relay is a viable NIP-50 candidate for Shopstr if it:

1. Advertises `50` in its NIP-11 `supported_nips` array.
2. Indexes kind `30402` (classified listings), not only kinds `0`/`1`.
3. Treats the `search` field as a substring / full-text match against event content **and** common tag values (`title`, `summary`).
4. Respects other filter fields (`kinds`, `authors`, `limit`, `since`/`until`) alongside `search`.
5. Degrades gracefully — an unsupported `search` field is silently ignored, not a `NOTICE`-and-disconnect.

### Per-relay verdict

| Relay                       | NIP-50 | Indexes kind 30402 | Search target                   | Verdict                                          |
| --------------------------- | ------ | ------------------ | ------------------------------- | ------------------------------------------------ |
| `wss://relay.nostr.band`    | Yes    | Yes                | content + title/tags            | **Primary candidate**                            |
| `wss://relay.primal.net`    | Yes    | Partial            | content only                    | **Secondary / fallback**                         |
| `wss://relay.damus.io`      | No     | Yes                | n/a — `search` silently ignored | Not a candidate                                  |
| `wss://nos.lol`             | No     | Yes                | n/a — `search` is a no-op       | Not a candidate                                  |
| `wss://purplepag.es`        | No     | No (kind 0 only)   | n/a                             | Not a candidate — profile-only relay             |
| `wss://sendit.nosflare.com` | No     | Write-only fanout  | n/a                             | Not a candidate — Blastr is a broadcast endpoint |

### Integration plan (derived from this evaluation)

1. Issue the NIP-50 `{ "kinds": [30402], "search": "<text>", "limit": N }` filter **only** to `relay.nostr.band` and `relay.primal.net`.
2. Union the relay results with whatever the local predicate (`listing-search-predicate.ts`) already selects from `ProductContext`, so non-NIP-50 relays never _narrow_ results.
3. Log the symmetric difference between "relay matched" and "local predicate matched" in development builds to quantify recall drift before promoting NIP-50 to the primary search path.

---

## Task 3 — Typed NIP-56 kind 1984 tag builder with tests

**Files:**
[`utils/nostr/nip56-report.ts`](utils/nostr/nip56-report.ts) · [`utils/nostr/__tests__/nip56-report.test.ts`](utils/nostr/__tests__/nip56-report.test.ts)

A typed helper that constructs valid NIP-56 kind 1984 report tag arrays for both profiles and listings. All seven canonical report types are modelled as a string-literal union so typos are caught at compile time; pubkeys and event ids are validated at runtime before a signer is ever asked to sign.

### NIP-56 tag shape summary

NIP-56 defines two distinct tag layouts depending on whether the report targets a profile or a listing event.

**Profile report** — `p` tag carries the report type; no `e` tag:

```
["p", <pubkey>, <report-type>]
```

**Listing (event) report** — `p` tag carries author pubkey only; `e` tag carries the report type. For parameterised replaceable events (kind 30402) an additional `a` tag preserves the report after the listing is replaced:

```
["p", <author-pubkey>]
["e", <event-id>, <report-type>]
["a", "<kind>:<pubkey>:<d-tag>", <report-type>]   ← only when addressable fields are provided
```

### API surface

```typescript
// Seven canonical labels — typos are compile errors
export type Nip56ReportType =
  | "nudity" | "malware" | "profanity" | "illegal"
  | "spam"   | "impersonation" | "other";

// Profile report → [["p", pubkey, reportType]]
buildProfileReportTags(input: ProfileReportInput): ReportTag[]

// Listing report → [["p", authorPubkey], ["e", eventId, reportType]]
//                  + optional ["a", "kind:pubkey:d", reportType]
buildListingReportTags(input: ListingReportInput): ReportTag[]

// Runtime type guard
isNip56ReportType(value: unknown): value is Nip56ReportType
```

### Usage

```bash
# Run the test suite
npx jest --testPathPatterns="nip56-report"
```

### What the output looks like

```
PASS utils/nostr/__tests__/nip56-report.test.ts
  NIP56_REPORT_TYPES
    ✓ exposes exactly the seven types defined by NIP-56
  isNip56ReportType
    ✓ accepts every canonical label
    ✓ rejects typos, case variants, and non-strings
  buildProfileReportTags
    ✓ returns a single `p` tag with pubkey and report type
    ✓ accepts uppercase hex (the regex is case-insensitive)
    ✓ throws for a non-hex pubkey
    ✓ throws for a pubkey with the wrong length
    ✓ throws for an unknown report type
  buildListingReportTags
    ✓ emits a `p` tag without a report type and an `e` tag with it
    ✓ adds an `a` tag when the listing is a parameterized replaceable event
    ✓ does NOT emit an `a` tag if only kind or only d-tag is provided
    ✓ throws for a non-hex authorPubkey
    ✓ throws for a non-hex eventId
    ✓ throws for an invalid addressableKind
    ✓ throws for an unknown report type

Tests: 12 passed (inside 5 describe blocks), 12 total
```

### Implementation notes

- `NIP56_REPORT_TYPES` is declared `as const` so `Nip56ReportType` is derived from it — the canonical list lives in exactly one place.
- The `a` tag is emitted **only** when both `addressableKind` and `addressableDTag` are supplied. Providing only one silently produces no `a` tag — consistent with NIP-56 treating the `a` tag as optional for replaceable events.
- Runtime validation (64-char hex check, known report-type check, non-negative integer kind) runs before any signing call so malformed events are rejected client-side, not leaked into the report stream.
- These builders are the foundation the `publishReport()` helper and `<ReportDialog />` component will call in Phase 3 of the project plan.

---

## Running all competency-test checks

```bash
# All 39 tests (Tasks 1 + 3)
npx jest --testPathPatterns="listing-search-predicate|nip56-report"

# TypeScript — zero errors expected
npx tsc --noEmit
```

Expected: **39 tests, 2 suites, 0 failures, 0 type errors.**
