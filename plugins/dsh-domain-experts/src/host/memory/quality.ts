/**
 * What a model-authored memory record has to clear before it is stored.
 *
 * An expert writes its own notes, and a weak model writes noise: a bare "ок", a
 * slash command echoed back, a "не нашёл информации" that then gets recalled
 * into every later prompt for that domain. The recall path injects these
 * verbatim (design §15), so one stored line of garbage keeps poisoning answers
 * until an operator deletes it. Refusing at the write is the only place the
 * loop can be cut.
 *
 * Deliberately narrow: every rule matches the whole text, never a substring,
 * because a false refusal costs the model a write it believed it made — and a
 * note that merely mentions "no data" inside a real finding stays acceptable.
 * This gate is not applied to an operator's edit: a person shortening or
 * emptying a note is doing maintenance, not writing noise.
 */

/** Why one write was refused; `ok` means it may be stored. */
export type MemoryTextVerdict =
  | "ok"
  | "empty"
  | "ack"
  | "punctuation"
  | "slash_command"
  | "placeholder"
  | "no_finding"
  | "too_short";

export interface MemoryTextCheck {
  readonly verdict: MemoryTextVerdict;
  readonly text: string;
  /** What to tell the model: the refusal plus the action that fixes it. */
  readonly message: string;
}

/** A command line the model echoed instead of a finding. */
const SLASH_COMMAND_RE = /^\/[a-z0-9_-]{1,64}\b/i;

/** A stub a write was supposed to replace. */
const PLACEHOLDER_RE =
  /^(?:\.{2,}|\?+|!+|_{3,}|-+|<[^>]*>|\{\{[^}]*\}\}|\[[^\]]*\]|\([^)]*\))$/;

/** The stubs a model leaves behind when it means to write the fact later. */
const PLACEHOLDERS: ReadonlySet<string> = new Set([
  "todo",
  "tbd",
  "fixme",
  "xxx",
  "placeholder",
  "text here",
  "fill in later",
  "заглушка",
  "дописать позже",
]);

/** Letters or digits: an all-symbol string carries nothing to recall. */
const HAS_LETTER_RE = /[\p{L}\p{N}]/u;

/** Every rule wants at least this much signal; see {@link hasEnoughSignal}. */
const MIN_SIGNAL_LENGTH = 12;

/**
 * Answers to a person, not findings for a later run.
 *
 * Matched against {@link canonical} text, so the list stays one form per phrase
 * instead of a punctuation-permutations regex. The stand speaks Russian and
 * English, and both are covered on purpose: a refusal the model reads as
 * gibberish is a refusal it retries.
 */
const ACKNOWLEDGEMENTS: ReadonlySet<string> = new Set([
  "ok",
  "okay",
  "k",
  "yes",
  "yep",
  "yeah",
  "no",
  "nope",
  "sure",
  "done",
  "thanks",
  "thank you",
  "thx",
  "got it",
  "understood",
  "will do",
  "ага",
  "да",
  "нет",
  "ок",
  "окей",
  "хорошо",
  "ладно",
  "ясно",
  "понял",
  "понятно",
  "принято",
  "спасибо",
  "благодарю",
  "ну ок",
  "давай",
  "не надо",
  "все",
  "всё",
]);

/** "Nothing here", which is not something to remember. */
const NO_FINDINGS: ReadonlySet<string> = new Set([
  "none",
  "nothing",
  "no data",
  "no info",
  "no information",
  "no finding",
  "no findings",
  "no result",
  "no results",
  "not found",
  "n/a",
  "na",
  "null",
  "undefined",
  "i dont know",
  "i do not know",
  "there is nothing",
  "nothing found",
  "нет",
  "нет данных",
  "нет информации",
  "нет результатов",
  "нет находок",
  "ничего",
  "ничего нет",
  "ничего не нашел",
  "информации нет",
  "данных нет",
  "не найдено",
  "не обнаружено",
  "не знаю",
  "не нашел",
  "не нашла",
  "не нашлось",
  "не нашел ничего",
  "не нашел информации",
  "не нашел данных",
]);

/**
 * The comparison form of a phrase: case- and punctuation-insensitive, one space
 * between words, and `ё` folded into `е` the way a reader types it.
 */
function canonical(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[\u2018\u2019']/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[.!?,;:\s]+$/u, "");
}

function hasEnoughSignal(text: string): boolean {
  // A CJK run carries meaning in fewer characters than a Latin one, so the
  // length floor is not the only test — the same reason the openviking capture
  // gate counts scripts separately.
  const cjk = text.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const alnum = text.match(/[a-z0-9]/giu)?.length ?? 0;
  return cjk >= 4 || alnum >= 6 || text.length >= MIN_SIGNAL_LENGTH;
}

/**
 * Decide whether one piece of model-authored text may become a memory record.
 *
 * Returns the trimmed text a store should keep, so a caller cannot accidentally
 * persist the padding it arrived with.
 */
export function checkMemoryText(raw: string): MemoryTextCheck {
  const text = raw.trim();
  if (text === "") {
    return {
      verdict: "empty",
      text,
      message:
        "Nothing was given to record. Pass the finding itself in `text`.",
    };
  }
  const phrase = canonical(text);
  if (ACKNOWLEDGEMENTS.has(phrase)) {
    return {
      verdict: "ack",
      text,
      message:
        "An acknowledgement is not a finding. Record only what a later answer would need and does not already have.",
    };
  }
  if (NO_FINDINGS.has(phrase)) {
    return {
      verdict: "no_finding",
      text,
      message:
        "Recording that nothing was found teaches later answers to repeat the miss. Absence of a fact is not itself a memory.",
    };
  }
  if (SLASH_COMMAND_RE.test(text)) {
    return {
      verdict: "slash_command",
      text,
      message:
        "A command line is not a finding. Record the durable fact it produced, not the command.",
    };
  }
  if (PLACEHOLDERS.has(phrase) || PLACEHOLDER_RE.test(text)) {
    return {
      verdict: "placeholder",
      text,
      message:
        "A placeholder is not a finding. Write the fact out in full or do not record it.",
    };
  }
  if (!HAS_LETTER_RE.test(text)) {
    return {
      verdict: "punctuation",
      text,
      message: "Punctuation alone carries nothing worth recalling.",
    };
  }
  if (!hasEnoughSignal(text)) {
    return {
      verdict: "too_short",
      text,
      message: `A memory of under ${String(MIN_SIGNAL_LENGTH)} characters is usually noise. State the finding and what it applies to.`,
    };
  }
  return { verdict: "ok", text, message: "" };
}
