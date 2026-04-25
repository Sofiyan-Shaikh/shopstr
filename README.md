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

# Authors

- [calvadev](nostr:npub16dhgpql60vmd4mnydjut87vla23a38j689jssaqlqqlzrtqtd0kqex0nkq)
  - npub16dhgpql60vmd4mnydjut87vla23a38j689jssaqlqqlzrtqtd0kqex0nkq
- [thomasyeung687](nostr:npub14u43en9xrzh92lmy8yk6fq3mme7vyul7x66n2zl6y35c3nt3y0lqhs3g74)
  - npub14u43en9xrzh92lmy8yk6fq3mme7vyul7x66n2zl6y35c3nt3y0lqhs3g74
- [ericspaghetti](nostr:npub1qxda7stfxfauufa4mkgqj2lur0jdpxlpnqhqdctwl2t6akuruw3qjdkkn0)
  - npub1qxda7stfxfauufa4mkgqj2lur0jdpxlpnqhqdctwl2t6akuruw3qjdkkn0

[![Run on Repl.it](https://replit.com/badge/github/calvadev/shopstr)](https://replit.com/new/github/calvadev/shopstr)

---

# Competency Test — NIP-50 Search & NIP-56 Reporting

> Submitted as part of the Summer of Bitcoin 2026 application for the
> **"Search and Reporting for the Decentralised Bitcoin Marketplace"** project.
> Author: Sofiyan Shaikh

The three tasks below match the competency-test requirements attached to this project on the SoB ideas page.

---

## Task 1 — Isolated listing search predicate with tests

**Why this was asked:** the project's first major deliverable is a NIP-50 relay-backed search flow. To measure whether the relay results agree with what Shopstr shows today, the current client-side filter logic had to be extracted into a standalone, dependency-free module so it can be run over both local events and relay events and the two sets compared.

**What was built:**

| File                                                       | Role                                 |
| ---------------------------------------------------------- | ------------------------------------ |
| `utils/parsers/listing-search-predicate.ts`                | The extracted predicate              |
| `utils/parsers/__tests__/listing-search-predicate.test.ts` | Test suite (27 cases)                |
| `utils/parsers/product-filter-helpers.ts`                  | Updated to delegate to the predicate |

**How the predicate works:**

`parseListingSearchQuery(rawQuery)` classifies any search string into one of four shapes before touching listing data:

- `empty` — blank / whitespace input → every listing passes.
- `naddr` — a valid bech32 `naddr1…` string → decoded to `{ pubkey, identifier }` for an exact address lookup.
- `npub` — a valid bech32 `npub1…` string → decoded to `{ pubkey }` for a per-seller lookup.
- `text` — everything else → case-insensitive substring match on `title` and `summary`, plus an optional exact numeric price match.

Malformed bech32 strings fall through to `text` (preserving prior behaviour). All regex metacharacters are escaped before building the `RegExp`, so a search for `(v2)` finds the literal substring, not a capture group.

`matchesListingSearch(listing, query)` evaluates a `SearchableListing` — a narrow type that contains only the fields the predicate needs (`pubkey`, `d`, `title`, `summary`, `price`) — against a parsed query. It is intentionally decoupled from `ProductData` so it can be called on raw relay events without running the full parser stack.

`listingMatchesSearchString` is a single-call convenience wrapper (parse + match) that is a drop-in replacement for the old `productSatisfiesSearchFilter`. The helper file now delegates to it, so existing call sites required zero changes.

**Test coverage highlights:**

- Empty and whitespace-only queries always return `true`.
- Valid `naddr`/`npub` strings decode correctly; malformed ones fall back to text.
- Text queries: case-insensitive title match, summary match when title misses, no match when title is absent.
- Numeric price: `"25"` matches a listing priced at 25; `"25.01"` does not.
- Regex metacharacters (`(`, `)`, `[`, `]`, `.`, `*`) are treated as literals.
- Integration tests verify `listingMatchesSearchString` end-to-end for all query shapes.

---

## Task 2 — NIP-50 relay evaluation note

**Why this was asked:** NIP-50 support varies widely across Nostr relays. Before building a relay-backed search flow it is necessary to know _which_ of Shopstr's configured relays actually implement it, what they index (content vs tag values), and how they behave when given a `search` filter they do not understand.

**What was built:** `docs/nip50-relay-evaluation.md`

The note covers all six relays Shopstr configures by default (`getDefaultRelays()` + `withBlastr()` in `utils/nostr/nostr-helper-functions.ts`):

| Relay                 | NIP-50 | Indexes kind 30402        | Verdict                                        |
| --------------------- | ------ | ------------------------- | ---------------------------------------------- |
| `relay.nostr.band`    | Yes    | Yes (content + title/tag) | **Primary candidate**                          |
| `relay.primal.net`    | Yes    | Partial (content only)    | **Secondary / fallback**                       |
| `relay.damus.io`      | No     | Yes                       | Not a candidate — `search` is silently ignored |
| `nos.lol`             | No     | Yes                       | Not a candidate — `search` is a no-op          |
| `purplepag.es`        | No     | No (kind 0 only)          | Not a candidate — profile-only relay           |
| `sendit.nosflare.com` | No     | Write-only fanout         | Not a candidate — not a query endpoint         |

The note explains five evaluation criteria (NIP-11 advertisement, kind 30402 indexing, search targets, filter composability, graceful fallback) and ends with a three-step integration plan:

1. Issue the NIP-50 `search` filter only to `relay.nostr.band` and `relay.primal.net`.
2. Union the relay results with whatever the local predicate already selects from `ProductContext`, so non-NIP-50 relays never _narrow_ results.
3. Log the symmetric difference between "relay matched" and "local predicate matched" in dev builds to quantify recall drift before promoting NIP-50 to the primary search path.

---

## Task 3 — Typed NIP-56 kind 1984 tag builder with tests

**Why this was asked:** the project's third major deliverable is a NIP-56 reporting flow (report listing / report profile). The tag shape for kind 1984 events is precise and has two distinct variants (profile vs event report). A typed, validated builder must exist before any UI or publish code is written so that wrong tag shapes are caught at the type level, never at runtime.

**What was built:**

| File                                         | Role                            |
| -------------------------------------------- | ------------------------------- |
| `utils/nostr/nip56-report.ts`                | Typed tag builders + type guard |
| `utils/nostr/__tests__/nip56-report.test.ts` | Test suite (12 cases)           |

**API surface:**

```typescript
// Seven canonical report types — typos are compile errors, not runtime surprises
export type Nip56ReportType =
  "nudity" | "malware" | "profanity" | "illegal" |
  "spam" | "impersonation" | "other";

// Profile report:  [["p", pubkey, reportType]]
buildProfileReportTags({ pubkey, reportType }): ReportTag[]

// Listing report:  [["p", authorPubkey], ["e", eventId, reportType]]
// + optional "a" tag for parameterised-replaceable listings (kind 30402)
buildListingReportTags({
  authorPubkey, eventId, reportType,
  addressableKind?, addressableDTag?,
}): ReportTag[]

// Runtime type guard
isNip56ReportType(value: unknown): value is Nip56ReportType
```

**Key design decisions:**

- `NIP56_REPORT_TYPES` is declared `as const` so the `Nip56ReportType` union is derived from the array, not re-listed. Adding a new label in one place is sufficient.
- Both builder functions validate their inputs at runtime (64-char hex pubkeys/event ids, known report type, non-negative integer kind) and throw with a message that names the failing field. This matters because the signer should never be asked to sign a malformed report event.
- The `a` tag is emitted only when _both_ `addressableKind` and `addressableDTag` are provided. Providing only one is silently ignored (no `a` tag) — this matches the NIP-56 spec where the `a` tag is optional, not required.

**Test coverage highlights:**

- All seven canonical labels accepted; typos, case variants (`"Spam"`), and non-strings rejected.
- Profile report: single `p` tag with correct shape.
- Listing report without addressable fields: `p` + `e`, no `a`.
- Listing report with both addressable fields: `p` + `e` + `a` with coordinate string `kind:pubkey:d`.
- Partial addressable fields (only kind or only d-tag): no `a` tag in either case.
- Non-hex pubkeys, short pubkeys, non-integer/negative `addressableKind`: each throws with a typed error message.

---

## Running the tests

```bash
npx jest --testPathPatterns="listing-search-predicate|nip56-report"
```

Expected output: **39 tests, 2 suites, 0 failures.**
