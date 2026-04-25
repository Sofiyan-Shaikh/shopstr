import { nip19 } from "nostr-tools";
import {
  SearchableListing,
  parseListingSearchQuery,
  matchesListingSearch,
  listingMatchesSearchString,
} from "../listing-search-predicate";

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);

const NPUB_A = nip19.npubEncode(PUBKEY_A);
const NPUB_B = nip19.npubEncode(PUBKEY_B);

const NADDR_A_BOTTLE = nip19.naddrEncode({
  identifier: "bottle-identifier",
  pubkey: PUBKEY_A,
  kind: 30402,
  relays: [],
});

const listing: SearchableListing = {
  pubkey: PUBKEY_A,
  d: "bottle-identifier",
  title: "Eco Friendly Water Bottle",
  summary: "A sustainable way to stay hydrated.",
  price: 25,
};

describe("parseListingSearchQuery", () => {
  it("returns `empty` for blank / whitespace-only input", () => {
    expect(parseListingSearchQuery("")).toEqual({ kind: "empty" });
    expect(parseListingSearchQuery("   ")).toEqual({ kind: "empty" });
  });

  it("decodes a valid naddr into its components", () => {
    expect(parseListingSearchQuery(NADDR_A_BOTTLE)).toEqual({
      kind: "naddr",
      identifier: "bottle-identifier",
      pubkey: PUBKEY_A,
    });
  });

  it("decodes a valid npub into its pubkey", () => {
    expect(parseListingSearchQuery(NPUB_A)).toEqual({
      kind: "npub",
      pubkey: PUBKEY_A,
    });
  });

  it("falls back to text when a `naddr1`/`npub1` token fails to decode", () => {
    expect(parseListingSearchQuery("naddr1notreal")).toEqual({
      kind: "text",
      text: "naddr1notreal",
      numeric: null,
    });
    expect(parseListingSearchQuery("npub1notreal")).toEqual({
      kind: "text",
      text: "npub1notreal",
      numeric: null,
    });
  });

  it("captures a numeric interpretation for price matching", () => {
    expect(parseListingSearchQuery("25")).toEqual({
      kind: "text",
      text: "25",
      numeric: 25,
    });
    expect(parseListingSearchQuery("bottle")).toEqual({
      kind: "text",
      text: "bottle",
      numeric: null,
    });
  });

  it("trims surrounding whitespace before classifying", () => {
    expect(parseListingSearchQuery("  bottle  ")).toEqual({
      kind: "text",
      text: "bottle",
      numeric: null,
    });
  });
});

describe("matchesListingSearch", () => {
  it("matches everything for an empty query", () => {
    expect(matchesListingSearch(listing, { kind: "empty" })).toBe(true);
  });

  describe("naddr address lookup", () => {
    it("matches only when pubkey AND d identifier both match", () => {
      expect(
        matchesListingSearch(listing, {
          kind: "naddr",
          identifier: "bottle-identifier",
          pubkey: PUBKEY_A,
        })
      ).toBe(true);
    });

    it("rejects when pubkey matches but identifier differs", () => {
      expect(
        matchesListingSearch(listing, {
          kind: "naddr",
          identifier: "other",
          pubkey: PUBKEY_A,
        })
      ).toBe(false);
    });

    it("rejects when identifier matches but pubkey differs", () => {
      expect(
        matchesListingSearch(listing, {
          kind: "naddr",
          identifier: "bottle-identifier",
          pubkey: PUBKEY_B,
        })
      ).toBe(false);
    });
  });

  describe("npub address lookup", () => {
    it("matches only when pubkeys are equal", () => {
      expect(
        matchesListingSearch(listing, { kind: "npub", pubkey: PUBKEY_A })
      ).toBe(true);
      expect(
        matchesListingSearch(listing, { kind: "npub", pubkey: PUBKEY_B })
      ).toBe(false);
    });
  });

  describe("text matching", () => {
    it("matches substrings in title (case-insensitive)", () => {
      expect(
        matchesListingSearch(listing, {
          kind: "text",
          text: "bottle",
          numeric: null,
        })
      ).toBe(true);
      expect(
        matchesListingSearch(listing, {
          kind: "text",
          text: "ECO",
          numeric: null,
        })
      ).toBe(true);
    });

    it("matches substrings in summary when title does not match", () => {
      expect(
        matchesListingSearch(listing, {
          kind: "text",
          text: "hydrated",
          numeric: null,
        })
      ).toBe(true);
    });

    it("returns false when the listing has no title", () => {
      expect(
        matchesListingSearch(
          { ...listing, title: undefined },
          { kind: "text", text: "bottle", numeric: null }
        )
      ).toBe(false);
    });

    it("matches exact numeric price", () => {
      expect(
        matchesListingSearch(listing, {
          kind: "text",
          text: "25",
          numeric: 25,
        })
      ).toBe(true);
      expect(
        matchesListingSearch(listing, {
          kind: "text",
          text: "25.01",
          numeric: 25.01,
        })
      ).toBe(false);
    });

    it("does not match price when `numeric` is null, even if text equals a number", () => {
      expect(
        matchesListingSearch(
          { ...listing, title: "A" },
          { kind: "text", text: "25", numeric: null }
        )
      ).toBe(false);
    });

    it("safely handles regex metacharacters (they are escaped, not interpreted)", () => {
      const special: SearchableListing = {
        ...listing,
        title: "Phone (v2) [Refurbished]",
      };
      expect(
        matchesListingSearch(special, {
          kind: "text",
          text: "(v2)",
          numeric: null,
        })
      ).toBe(true);
      expect(
        matchesListingSearch(special, {
          kind: "text",
          text: "[Refurbished]",
          numeric: null,
        })
      ).toBe(true);
    });
  });
});

describe("listingMatchesSearchString (integration)", () => {
  it("is the identity for whitespace-only queries", () => {
    expect(listingMatchesSearchString(listing, "   ")).toBe(true);
  });

  it("matches on text", () => {
    expect(listingMatchesSearchString(listing, "bottle")).toBe(true);
    expect(listingMatchesSearchString(listing, "smartphone")).toBe(false);
  });

  it("matches on exact numeric price", () => {
    expect(listingMatchesSearchString(listing, "25")).toBe(true);
    expect(listingMatchesSearchString(listing, "25.01")).toBe(false);
  });

  it("matches on a real naddr when pubkey + identifier align", () => {
    expect(listingMatchesSearchString(listing, NADDR_A_BOTTLE)).toBe(true);
  });

  it("matches on a real npub that equals the listing pubkey", () => {
    expect(listingMatchesSearchString(listing, NPUB_A)).toBe(true);
    expect(listingMatchesSearchString(listing, NPUB_B)).toBe(false);
  });

  it("does not crash on malformed bech32 — returns false when it also fails the text fallback", () => {
    expect(listingMatchesSearchString(listing, "naddr1invalid")).toBe(false);
    expect(listingMatchesSearchString(listing, "npub1invalid")).toBe(false);
  });

  // The following cases document the predicate surface that a future
  // NIP-50 flow must be compared against:
  //   - NIP-50 is a text-only flow, so the `kind: "text"` branch is
  //     the one that must agree with relay output.
  //   - naddr / npub queries bypass the relay because they are pure
  //     address lookups, and should continue to be handled locally.
  //   - numeric-price matching is a local-only feature that NIP-50
  //     relays will not implement; any diff should be filtered out
  //     before comparison.
  it("text-branch semantics are self-contained (no relay dependency)", () => {
    const q = parseListingSearchQuery("bottle");
    expect(q.kind).toBe("text");
    expect(matchesListingSearch(listing, q)).toBe(true);
  });
});
