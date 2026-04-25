# NIP-50 Relay Candidacy for Shopstr Listing Search

## Scope

Shopstr currently filters listings client-side via
`utils/parsers/listing-search-predicate.ts`. We want to evaluate which of
the six relays currently configured by default in Shopstr are viable
candidates for a future NIP-50 search flow and record how each of them
behaves when given a `"search"` filter.

Configured relays (see `getDefaultRelays` and `withBlastr` in
`utils/nostr/nostr-helper-functions.ts`):

1. `wss://relay.damus.io`
2. `wss://nos.lol`
3. `wss://purplepag.es`
4. `wss://relay.primal.net`
5. `wss://relay.nostr.band`
6. `wss://sendit.nosflare.com` (Blastr — write-fanout)

## Evaluation criteria

A relay is a good NIP-50 candidate for Shopstr if it:

1. Advertises NIP-50 in its NIP-11 document (`"supported_nips"` contains
   `50`).
2. Indexes the kinds Shopstr cares about — primarily kind `30402`
   (classified listings) and kind `30018` (wiki) — rather than only
   kinds `0`/`1`.
3. Treats the `search` filter as a substring / full-text match against
   the event `content` _and_ common tag values (`title`, `summary`),
   not a noop.
4. Respects the other fields in the filter (`kinds`, `authors`,
   `limit`, `since`/`until`) so NIP-50 composes with our existing
   queries.
5. Degrades gracefully — an unsupported `search` parameter should be
   ignored, not returned as `NOTICE`-and-disconnect.

## Per-relay assessment

| Relay                       | NIP-50 | Indexes kind 30402 | Search target               | Notes                                                                                            |
| --------------------------- | ------ | ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `wss://relay.nostr.band`    | Yes    | Yes                | content + tags (title/tags) | Primary candidate. Purpose-built index, supports `include:spam` and language hints.              |
| `wss://relay.primal.net`    | Yes    | Partial            | content only                | Secondary candidate. Works for free-text but tag-based matching (`title`, `t`) is unreliable.    |
| `wss://relay.damus.io`      | No     | Yes                | n/a (ignores `search`)      | Not a candidate. Will happily return events for other filter fields but silently drops `search`. |
| `wss://nos.lol`             | No     | Yes                | n/a (ignores `search`)      | Not a candidate. Same behavior as Damus — the `search` arg is accepted but no-op.                |
| `wss://purplepag.es`        | No     | No (kind 0 only)   | n/a                         | Not a candidate. Profile-only relay; kind 30402 is out of scope by design.                       |
| `wss://sendit.nosflare.com` | No     | Write-only fanout  | n/a                         | Not a candidate. Blastr is for broadcasting writes; it is not a query endpoint.                  |

## Behavior of `{"search": ...}` on each relay

- **relay.nostr.band** — Returns events whose indexed fields contain
  the token. Matches on title/tag values in addition to content, so a
  search for a listing title ("eco bottle") finds the classified
  directly. Ranks results by a heuristic; combined with
  `{"kinds":[30402], "limit":N}` it yields the closest analogue to the
  current local predicate.
- **relay.primal.net** — Accepts `search` and returns matches against
  event content. Tag-value matches (the title tag on kind 30402) are
  not consistent, so listings whose search-term appears only in the
  `title` tag may be missed. Useful as a redundancy relay but should
  not be the sole source.
- **relay.damus.io** / **nos.lol** — Both ignore the `search` field and
  return whatever the rest of the filter selects. For the NIP-50 flow
  this means the client has to fall back to the local predicate, so
  these relays are fine as regular subscription endpoints but
  contribute no search capability.
- **purplepag.es** — Dedicated to profile/contact-list caching; does
  not serve kind 30402 at all. Irrelevant to listing search.
- **sendit.nosflare.com** — Write fanout, not a query endpoint.
  Excluded.

## Recommendation

- **Primary search relay:** `wss://relay.nostr.band`.
- **Secondary / fallback:** `wss://relay.primal.net`, with the caveat
  that content-only indexing means the client must still run the local
  predicate over the returned events before displaying them.
- **All other relays:** continue to query as today (no `search` field)
  and rely on the local predicate.

## Integration plan (summary)

1. Issue the NIP-50 query only to the two candidate relays. Tag the
   resulting events by source relay so we can compare recall.
2. Union the relay results with whatever the local predicate (see
   `utils/parsers/listing-search-predicate.ts`) selects from events
   already in `ProductContext`. This keeps behaviour unchanged for
   relays that ignore `search`.
3. Log the symmetric difference between "relay said match" and "local
   predicate said match" in development builds to quantify drift
   before promoting NIP-50 to the primary search path.
