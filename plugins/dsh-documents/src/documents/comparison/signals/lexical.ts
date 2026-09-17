/**
 * Lexical signals (§18).
 *
 * The most dangerous edits in a contract are the smallest ones: a `не` that
 * appears, `обязан` that turns into `вправе`, `Заказчик` that becomes
 * `Исполнитель`. Nothing about the shape of the sentence changes, so no
 * structural signal fires — only a vocabulary one does.
 *
 * Each class is a list of probes, and a probe answers with the canonical name
 * of what it matched. A class "changed" when the set of names it produced
 * differs between the two versions, which keeps the signal about vocabulary
 * and not about word counts.
 *
 * Prohibition is matched before permission so that `не вправе` is reported as
 * a prohibition rather than as permission plus a negation; matches already
 * claimed by a wider probe are not re-reported.
 */

import { foldForLookup } from "../canonical/normalize.js";
import type { ChangeSignal } from "../types.js";

interface Probe {
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * Russian has no `\b` for `\w` purposes in JavaScript, so a probe is bounded
 * by explicit "not a letter or digit" lookarounds instead — on both sides,
 * because the `не` inside `несёт` is not the negation particle.
 */
function probe(name: string, body: string): Probe {
  return {
    name,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "gu"),
  };
}

const OBLIGATION: readonly Probe[] = [
  probe("обязан", String.raw`обязан\p{L}*`),
  probe("должен", String.raw`долж(?:ен|на|но|ны)`),
  probe("обязуется", String.raw`обязует\p{L}*`),
  probe("принимает-на-себя", String.raw`принимает\s+на\s+себя`),
  probe("shall", String.raw`shall`),
  probe("must", String.raw`must`),
  probe("undertakes", String.raw`undertakes?`),
];

const PERMISSION: readonly Probe[] = [
  probe("вправе", String.raw`(?:в|В)\s+праве`),
  probe("вправе", String.raw`вправе`),
  probe("имеет-право", String.raw`име(?:ет|ют)\s+право`),
  probe("правомочен", String.raw`правомоч\p{L}*`),
  probe("может", String.raw`мож(?:ет|ут|но)`),
  probe("may", String.raw`may`),
  probe("entitled", String.raw`entitled`),
];

const PROHIBITION: readonly Probe[] = [
  // `не вправе` and `невправе` are not words, but `не вправе` is written both
  // with and without the space after `в` in real documents.
  probe("не-вправе", String.raw`не\s+(?:в\s*)?праве`),
  probe("не-имеет-права", String.raw`не\s+име(?:ет|ют)\s+права`),
  probe("не-может", String.raw`не\s+мож(?:ет|ут|но)`),
  probe("не-допускается", String.raw`не\s+допускает\p{L}*`),
  probe("не-разрешается", String.raw`не\s+разреша\p{L}*`),
  probe("не-подлежит", String.raw`не\s+подлеж(?:ит|ат)`),
  probe("запрещается", String.raw`запреща\p{L}*`),
  probe("запрещено", String.raw`запрещен\p{L}*`),
  probe("may-not", String.raw`may\s+not`),
  probe("must-not", String.raw`must\s+not`),
  probe("shall-not", String.raw`shall\s+not`),
  probe("prohibited", String.raw`prohibited`),
];

const LIABILITY: readonly Probe[] = [
  probe("ответственность", String.raw`ответственн\p{L}*`),
  probe("неустойка", String.raw`неустойк\p{L}*`),
  probe("штраф", String.raw`штраф\p{L}*`),
  probe("пени", String.raw`пен[иья]\p{L}*`),
  probe("убытки", String.raw`убытк\p{L}*`),
  probe("возмещение", String.raw`возмещ\p{L}*`),
  probe("компенсация", String.raw`компенсац\p{L}*`),
  probe("liability", String.raw`liabilit\p{L}*`),
  probe("penalty", String.raw`penalt\p{L}*`),
  probe("damages", String.raw`damages`),
  probe("indemnity", String.raw`indemnif\p{L}*`),
];

const NEGATION: readonly Probe[] = [
  probe("не", String.raw`не`),
  probe("ни", String.raw`ни`),
  probe("без", String.raw`без`),
  probe("нет", String.raw`нет`),
  probe("кроме", String.raw`кроме`),
  probe("исключение", String.raw`исключен\p{L}*`),
  probe("отсутствие", String.raw`отсутств\p{L}*`),
  probe("not", String.raw`not`),
  probe("no", String.raw`no`),
  probe("without", String.raw`without`),
  probe("unless", String.raw`unless`),
  probe("never", String.raw`never`),
];

const PARTY_REFERENCE: readonly Probe[] = [
  probe("заказчик", String.raw`заказчик\p{L}*`),
  probe("исполнитель", String.raw`исполнител\p{L}*`),
  probe("поставщик", String.raw`поставщик\p{L}*`),
  probe("подрядчик", String.raw`подрядчик\p{L}*`),
  probe("покупатель", String.raw`покупател\p{L}*`),
  probe("продавец", String.raw`продав(?:ец|ц\p{L}*)`),
  probe("лицензиар", String.raw`лицензиар\p{L}*`),
  probe("лицензиат", String.raw`лицензиат\p{L}*`),
  probe("арендодатель", String.raw`арендодател\p{L}*`),
  probe("арендатор", String.raw`арендатор\p{L}*`),
  probe("агент", String.raw`агент\p{L}*`),
  probe("принципал", String.raw`принципал\p{L}*`),
  probe("контрагент", String.raw`контрагент\p{L}*`),
  probe("сторона", String.raw`сторон(?:а|ы|е|у|ой|ам|ами|ах)`),
  probe("customer", String.raw`customer`),
  probe("contractor", String.raw`contractor`),
  probe("supplier", String.raw`supplier`),
  probe("client", String.raw`client`),
  probe("vendor", String.raw`vendor`),
  probe("licensor", String.raw`licensor`),
  probe("licensee", String.raw`licensee`),
  probe("lessor", String.raw`lessor`),
  probe("lessee", String.raw`lessee`),
  probe("buyer", String.raw`buyer`),
  probe("seller", String.raw`seller`),
  probe("party", String.raw`part(?:y|ies)`),
];

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"'«»]+/giu;
const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

export interface LexicalFeatures {
  readonly obligation: readonly string[];
  readonly permission: readonly string[];
  readonly prohibition: readonly string[];
  readonly liability: readonly string[];
  readonly negation: readonly string[];
  readonly parties: readonly string[];
  readonly urls: readonly string[];
  readonly emails: readonly string[];
}

interface MatchSpan {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

function probes(folded: string, list: readonly Probe[]): MatchSpan[] {
  const spans: MatchSpan[] = [];
  for (const entry of list) {
    const scanner = new RegExp(entry.pattern.source, entry.pattern.flags);
    for (const match of folded.matchAll(scanner)) {
      spans.push({
        start: match.index,
        end: match.index + match[0].length,
        name: entry.name,
      });
    }
  }
  return spans;
}

function overlaps(spans: readonly MatchSpan[], candidate: MatchSpan): boolean {
  return spans.some(
    (span) => candidate.start < span.end && span.start < candidate.end,
  );
}

function names(spans: readonly MatchSpan[]): string[] {
  return [...new Set(spans.map((span) => span.name))].sort();
}

export function lexicalFeatures(text: string): LexicalFeatures {
  const folded = foldForLookup(text);
  const prohibition = probes(folded, PROHIBITION);
  const permission = probes(folded, PERMISSION).filter(
    (candidate) => !overlaps(prohibition, candidate),
  );
  return {
    obligation: names(probes(folded, OBLIGATION)),
    permission: names(permission),
    prohibition: names(prohibition),
    liability: names(probes(folded, LIABILITY)),
    negation: names(probes(folded, NEGATION)),
    parties: names(probes(folded, PARTY_REFERENCE)),
    urls: sortedUnique(matchAll(text, URL_PATTERN)),
    emails: sortedUnique(matchAll(text, EMAIL_PATTERN)),
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))].sort();
}

function matchAll(text: string, pattern: RegExp): string[] {
  const scanner = new RegExp(pattern.source, pattern.flags);
  return [...text.matchAll(scanner)].map((match) => match[0]);
}

/** Compare two feature lists as sets. */
export function featuresChanged(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return true;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return true;
  }
  return false;
}

/** The signal a vocabulary class maps to. */
export const CLASS_SIGNALS: Readonly<
  Record<
    keyof Pick<
      LexicalFeatures,
      "obligation" | "permission" | "prohibition" | "liability"
    >,
    ChangeSignal
  >
> = {
  obligation: "OBLIGATION_TERM_CHANGED",
  permission: "PERMISSION_TERM_CHANGED",
  prohibition: "PROHIBITION_TERM_CHANGED",
  liability: "LIABILITY_TERM_CHANGED",
};
