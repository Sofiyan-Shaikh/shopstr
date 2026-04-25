import { nip19 } from "nostr-tools";

/**
 * The minimal subset of a listing required to evaluate the local
 * client-side search predicate. Decoupled from `ProductData` so the
 * predicate can be compared against the output of a NIP-50 relay
 * search without pulling in parser/type dependencies.
 */
export type SearchableListing = {
  pubkey: string;
  d?: string;
  title?: string;
  summary?: string;
  price?: number;
};

export type ListingSearchQuery =
  | { kind: "empty" }
  | { kind: "naddr"; identifier: string; pubkey: string }
  | { kind: "npub"; pubkey: string }
  | { kind: "text"; text: string; numeric: number | null };

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Classifies a raw search string into one of the supported query kinds.
 *
 * Naddr / npub queries are *address lookups* (exact equality on pubkey
 * and — for naddr — the `d` identifier). Everything else is treated as
 * a free-text query, which is the surface that a future NIP-50 flow
 * will hand to the relay.
 */
export const parseListingSearchQuery = (
  rawQuery: string
): ListingSearchQuery => {
  const trimmed = rawQuery.trim();
  if (!trimmed) return { kind: "empty" };

  if (trimmed.includes("naddr1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "naddr") {
        return {
          kind: "naddr",
          identifier: decoded.data.identifier,
          pubkey: decoded.data.pubkey,
        };
      }
    } catch {
      // fall through to text matching below — preserves prior behaviour
      // of returning `false` for malformed naddr strings by letting the
      // predicate fail to match real listings.
    }
    return { kind: "text", text: trimmed, numeric: null };
  }

  if (trimmed.includes("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") {
        return { kind: "npub", pubkey: decoded.data };
      }
    } catch {
      // same fall-through rationale as above
    }
    return { kind: "text", text: trimmed, numeric: null };
  }

  const numeric = Number.parseFloat(trimmed);
  return {
    kind: "text",
    text: trimmed,
    numeric: Number.isFinite(numeric) ? numeric : null,
  };
};

/**
 * Evaluates whether a listing matches a parsed query.
 *
 * The text branch is intentionally narrow — title + summary substring
 * match plus exact numeric price — so the predicate mirrors what the
 * NIP-50 `search` field is expected to cover on the relay side. When
 * the NIP-50 flow lands, the same predicate can be run over relay
 * results to measure drift (missed matches / false positives).
 */
export const matchesListingSearch = (
  listing: SearchableListing,
  query: ListingSearchQuery
): boolean => {
  switch (query.kind) {
    case "empty":
      return true;

    case "naddr":
      return listing.pubkey === query.pubkey && listing.d === query.identifier;

    case "npub":
      return listing.pubkey === query.pubkey;

    case "text": {
      if (!listing.title) return false;
      try {
        const re = new RegExp(escapeRegExp(query.text), "i");
        if (re.test(listing.title)) return true;
        if (listing.summary && re.test(listing.summary)) return true;
      } catch {
        return false;
      }
      if (
        query.numeric !== null &&
        listing.price !== undefined &&
        listing.price === query.numeric
      ) {
        return true;
      }
      return false;
    }
  }
};

/**
 * Convenience wrapper: parse + match in one call. Identical semantics
 * to the legacy `productSatisfiesSearchFilter`, so it can be dropped
 * into the current filter pipeline unchanged.
 */
export const listingMatchesSearchString = (
  listing: SearchableListing,
  rawQuery: string
): boolean => matchesListingSearch(listing, parseListingSearchQuery(rawQuery));
