/**
 * Content normalization for the L0 scanner (design SPEC §6, §38).
 *
 * Attackers hide keywords behind zero-width characters, homoglyphs, and
 * encodings. `foldText` produces the canonical comparison form;
 * `decodeEncodings` extracts bounded decoded candidates (base64, URL percent
 * escapes, hex) so pattern rules also run over de-obfuscated text.
 */

/** Zero-width and invisible formatting characters (Unicode Cf/Co + ZWSP etc.). */
const ZERO_WIDTH = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u{E0000}-\u{E007F}]/gu;

/**
 * Common Cyrillic/Greek homoglyphs folded onto their Latin counterparts.
 * Deliberately small: only letters whose substitution would hide a keyword.
 */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ѕ: "s", ј: "j",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T",
  У: "Y", Х: "X", І: "I", Ѕ: "S", Ј: "J",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P",
  Τ: "T", Υ: "Y", Χ: "X", ο: "o", α: "a", ε: "e",
};

const BASE64_RUN = /[A-Za-z0-9+/=]{24,}/g;
const HEX_RUN = /\b[0-9a-fA-F]{48,}\b/g;
const PERCENT_RUN = /(?:%[0-9a-fA-F]{2}){8,}/g;

/** Decoded candidate with the encoding name, for audit attribution. */
export interface DecodedCandidate {
  readonly encoding: "base64" | "hex" | "percent";
  readonly text: string;
}

export interface FoldResult {
  /** Canonical comparison form: zero-width-stripped, NFKC, homoglyph-folded, lowercased. */
  readonly folded: string;
  /** Zero-width-stripped, NFKC, lowercased — no homoglyph folding (for native-script rules). */
  readonly plain: string;
  /** Zero-width-stripped, NFKC, original case (for entropy heuristics). */
  readonly cased: string;
  /** Number of invisible characters removed. */
  readonly zeroWidthRemoved: number;
  /** True when folding changed letters (homoglyph obfuscation signal). */
  readonly foldedChanged: boolean;
}

function foldHomoglyphs(text: string): string {
  let changed = false;
  let out = "";
  for (const char of text) {
    const replacement = HOMOGLYPHS[char];
    if (replacement !== undefined) {
      out += replacement;
      changed = true;
    } else {
      out += char;
    }
  }
  return changed ? out.normalize("NFKC") : out;
}

/**
 * Fold raw content into its canonical comparison form. Latin text survives
 * byte-identical apart from lowercasing; obfuscated variants converge onto
 * the plaintext an attacker is hiding. `plain` keeps the original script so
 * Cyrillic/other non-Latin rules still match after homoglyph folding of the
 * `folded` view.
 */
export function foldText(raw: string): FoldResult {
  const zeroWidthMatches = raw.match(ZERO_WIDTH);
  const zeroWidthRemoved = zeroWidthMatches?.length ?? 0;
  const stripped = zeroWidthRemoved > 0 ? raw.replace(ZERO_WIDTH, "") : raw;
  const normalized = stripped.normalize("NFKC");
  const folded = foldHomoglyphs(normalized).toLowerCase();
  return {
    folded,
    plain: normalized.toLowerCase(),
    cased: normalized,
    zeroWidthRemoved,
    foldedChanged: folded !== normalized.toLowerCase(),
  };
}

function decodeBase64(run: string): string | null {
  const compact = run.replace(/=+$/, "");
  if (compact.length < 16 || compact.length % 4 === 1) return null;
  const rest = compact.length % 4;
  const padded = rest === 0 ? compact : compact + "=".repeat(4 - rest);
  try {
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    // Reject decodings whose replacement-character ratio suggests binary data.
    if (decoded.includes("\uFFFD")) return null;
    return /[\x20-\x7E\u0400-\u04FF\s]{8}/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Extract decoded candidates from raw content, bounded so hostile payloads
 * cannot make the scanner quadratic. At most 16 candidates per encoding, each
 * truncated to 4096 characters.
 */
export function decodeEncodings(raw: string, limit = 4_096): DecodedCandidate[] {
  const candidates: DecodedCandidate[] = [];
  const push = (encoding: DecodedCandidate["encoding"], text: string | null): void => {
    if (text !== null && text.length >= 8) candidates.push({ encoding, text: text.slice(0, limit) });
  };

  let seen = 0;
  for (const match of raw.matchAll(BASE64_RUN)) {
    if (seen++ >= 16) break;
    push("base64", decodeBase64(match[0]));
  }
  seen = 0;
  for (const match of raw.matchAll(PERCENT_RUN)) {
    if (seen++ >= 16) break;
    try {
      push("percent", decodeURIComponent(match[0]));
    } catch {
      // Malformed percent escapes are noise, not obfuscation evidence.
    }
  }
  seen = 0;
  for (const match of raw.matchAll(HEX_RUN)) {
    if (seen++ >= 16) break;
    const hex = match[0];
    if (hex.length % 2 !== 0) continue;
    let text = "";
    for (let index = 0; index < hex.length && text.length < limit; index += 2) {
      text += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
    }
    push("hex", /^[\x20-\x7E\s]+$/.test(text) ? text : null);
  }
  return candidates;
}
