/**
 * Helpers for constructing tag arrays for NIP-56 reporting events
 * (kind 1984).
 *
 * Reference: https://github.com/nostr-protocol/nips/blob/master/56.md
 *
 * Shape summary (as enforced here):
 *
 * - A report on a *profile* carries a single `p` tag whose third
 *   element is the report type, and no `e` tag.
 *
 *     ["p", <pubkey>, <report-type>]
 *
 * - A report on a *listing* (event) carries a `p` tag without a
 *   report type plus an `e` tag whose third element is the report
 *   type. When the listing is a parameterized replaceable event
 *   (kind 30402 classified listings) we also attach an `a` tag so
 *   the report can be resolved after future replacements.
 *
 *     ["p", <author-pubkey>]
 *     ["e", <event-id>, <report-type>]
 *     ["a", "<kind>:<pubkey>:<d-tag>", <report-type>]   // optional
 */

/**
 * The canonical set of NIP-56 report types.
 *
 * NB: NIP-56 lists exactly these seven labels. We model them as a
 * string-literal union so callers get autocomplete + compile-time
 * checking, and any typo ("spma") is rejected at the type level.
 */
export const NIP56_REPORT_TYPES = [
  "nudity",
  "malware",
  "profanity",
  "illegal",
  "spam",
  "impersonation",
  "other",
] as const;

export type Nip56ReportType = (typeof NIP56_REPORT_TYPES)[number];

export type ReportTag = [string, ...string[]];

export type ProfileReportInput = {
  /** Hex-encoded pubkey being reported. */
  pubkey: string;
  reportType: Nip56ReportType;
};

export type ListingReportInput = {
  /** Hex-encoded pubkey of the listing's author. */
  authorPubkey: string;
  /** Hex-encoded id of the specific event being reported. */
  eventId: string;
  reportType: Nip56ReportType;
  /**
   * Optional coordinate pieces for parameterized replaceable events
   * (e.g. kind 30402 listings). When both are supplied, an `a` tag is
   * emitted alongside the `e` tag so the report survives listing
   * replacement.
   */
  addressableKind?: number;
  addressableDTag?: string;
};

const HEX64_RE = /^[0-9a-f]{64}$/i;

function assertHex64(value: string, label: string): void {
  if (!HEX64_RE.test(value)) {
    throw new Error(
      `nip56-report: ${label} must be a 64-char hex string, got "${value}"`
    );
  }
}

function assertReportType(value: string): asserts value is Nip56ReportType {
  if (!(NIP56_REPORT_TYPES as readonly string[]).includes(value)) {
    throw new Error(
      `nip56-report: "${value}" is not a valid NIP-56 report type`
    );
  }
}

/**
 * Builds the tag array for a NIP-56 kind 1984 report that targets a
 * *profile* (pubkey-only report).
 */
export const buildProfileReportTags = (
  input: ProfileReportInput
): ReportTag[] => {
  assertHex64(input.pubkey, "pubkey");
  assertReportType(input.reportType);
  return [["p", input.pubkey, input.reportType]];
};

/**
 * Builds the tag array for a NIP-56 kind 1984 report that targets a
 * *listing* (event report). The `p` tag carries the author pubkey
 * without a report type, and the `e` tag carries the report type on
 * the event id — matching the NIP-56 spec.
 *
 * If `addressableKind` and `addressableDTag` are both supplied, an
 * `a` tag (kind:pubkey:d) is appended so the report can still be
 * resolved after the listing is replaced.
 */
export const buildListingReportTags = (
  input: ListingReportInput
): ReportTag[] => {
  assertHex64(input.authorPubkey, "authorPubkey");
  assertHex64(input.eventId, "eventId");
  assertReportType(input.reportType);

  const tags: ReportTag[] = [
    ["p", input.authorPubkey],
    ["e", input.eventId, input.reportType],
  ];

  const { addressableKind, addressableDTag } = input;
  if (addressableKind !== undefined && addressableDTag !== undefined) {
    if (!Number.isInteger(addressableKind) || addressableKind < 0) {
      throw new Error(
        `nip56-report: addressableKind must be a non-negative integer, got ${addressableKind}`
      );
    }
    tags.push([
      "a",
      `${addressableKind}:${input.authorPubkey}:${addressableDTag}`,
      input.reportType,
    ]);
  }

  return tags;
};

export const isNip56ReportType = (value: unknown): value is Nip56ReportType =>
  typeof value === "string" &&
  (NIP56_REPORT_TYPES as readonly string[]).includes(value);
