import {
  NIP56_REPORT_TYPES,
  buildProfileReportTags,
  buildListingReportTags,
  isNip56ReportType,
} from "../nip56-report";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_UPPER = "A".repeat(64);

describe("NIP56_REPORT_TYPES", () => {
  it("exposes exactly the seven types defined by NIP-56", () => {
    expect([...NIP56_REPORT_TYPES].sort()).toEqual(
      [
        "illegal",
        "impersonation",
        "malware",
        "nudity",
        "other",
        "profanity",
        "spam",
      ].sort()
    );
  });
});

describe("isNip56ReportType", () => {
  it("accepts every canonical label", () => {
    for (const label of NIP56_REPORT_TYPES) {
      expect(isNip56ReportType(label)).toBe(true);
    }
  });

  it("rejects typos, case variants, and non-strings", () => {
    expect(isNip56ReportType("Spam")).toBe(false);
    expect(isNip56ReportType("spma")).toBe(false);
    expect(isNip56ReportType("")).toBe(false);
    expect(isNip56ReportType(undefined)).toBe(false);
    expect(isNip56ReportType(1984)).toBe(false);
  });
});

describe("buildProfileReportTags", () => {
  it("returns a single `p` tag with pubkey and report type", () => {
    expect(
      buildProfileReportTags({ pubkey: HEX_A, reportType: "impersonation" })
    ).toEqual([["p", HEX_A, "impersonation"]]);
  });

  it("accepts uppercase hex (the regex is case-insensitive)", () => {
    expect(
      buildProfileReportTags({ pubkey: HEX_UPPER, reportType: "spam" })
    ).toEqual([["p", HEX_UPPER, "spam"]]);
  });

  it("throws for a non-hex pubkey", () => {
    expect(() =>
      buildProfileReportTags({ pubkey: "not-hex", reportType: "spam" })
    ).toThrow(/64-char hex/);
  });

  it("throws for a pubkey with the wrong length", () => {
    expect(() =>
      buildProfileReportTags({ pubkey: "a".repeat(63), reportType: "spam" })
    ).toThrow(/64-char hex/);
  });

  it("throws for an unknown report type", () => {
    expect(() =>
      buildProfileReportTags({
        pubkey: HEX_A,
        // @ts-expect-error: intentionally wrong to verify runtime check
        reportType: "rude",
      })
    ).toThrow(/not a valid NIP-56 report type/);
  });
});

describe("buildListingReportTags", () => {
  it("emits a `p` tag without a report type and an `e` tag with it", () => {
    expect(
      buildListingReportTags({
        authorPubkey: HEX_A,
        eventId: HEX_B,
        reportType: "illegal",
      })
    ).toEqual([
      ["p", HEX_A],
      ["e", HEX_B, "illegal"],
    ]);
  });

  it("adds an `a` tag when the listing is a parameterized replaceable event", () => {
    expect(
      buildListingReportTags({
        authorPubkey: HEX_A,
        eventId: HEX_B,
        reportType: "spam",
        addressableKind: 30402,
        addressableDTag: "my-listing",
      })
    ).toEqual([
      ["p", HEX_A],
      ["e", HEX_B, "spam"],
      ["a", `30402:${HEX_A}:my-listing`, "spam"],
    ]);
  });

  it("does NOT emit an `a` tag if only kind or only d-tag is provided", () => {
    expect(
      buildListingReportTags({
        authorPubkey: HEX_A,
        eventId: HEX_B,
        reportType: "other",
        addressableKind: 30402,
      })
    ).toEqual([
      ["p", HEX_A],
      ["e", HEX_B, "other"],
    ]);

    expect(
      buildListingReportTags({
        authorPubkey: HEX_A,
        eventId: HEX_B,
        reportType: "other",
        addressableDTag: "my-listing",
      })
    ).toEqual([
      ["p", HEX_A],
      ["e", HEX_B, "other"],
    ]);
  });

  it("throws for a non-hex authorPubkey", () => {
    expect(() =>
      buildListingReportTags({
        authorPubkey: "not-hex",
        eventId: HEX_B,
        reportType: "spam",
      })
    ).toThrow(/authorPubkey must be a 64-char hex/);
  });

  it("throws for a non-hex eventId", () => {
    expect(() =>
      buildListingReportTags({
        authorPubkey: HEX_A,
        eventId: "not-hex",
        reportType: "spam",
      })
    ).toThrow(/eventId must be a 64-char hex/);
  });

  it("throws for an invalid addressableKind", () => {
    expect(() =>
      buildListingReportTags({
        authorPubkey: HEX_A,
        eventId: HEX_B,
        reportType: "spam",
        addressableKind: -1,
        addressableDTag: "x",
      })
    ).toThrow(/non-negative integer/);

    expect(() =>
      buildListingReportTags({
        authorPubkey: HEX_A,
        eventId: HEX_B,
        reportType: "spam",
        addressableKind: 1.5,
        addressableDTag: "x",
      })
    ).toThrow(/non-negative integer/);
  });

  it("throws for an unknown report type", () => {
    expect(() =>
      buildListingReportTags({
        authorPubkey: HEX_A,
        eventId: HEX_B,
        // @ts-expect-error: intentionally wrong to verify runtime check
        reportType: "meh",
      })
    ).toThrow(/not a valid NIP-56 report type/);
  });
});
