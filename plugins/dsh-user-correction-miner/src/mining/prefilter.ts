export interface CorrectionPrefilterResult {
  readonly matched: boolean;
  readonly signals: readonly string[];
  readonly likelyOneOff: boolean;
}

const SIGNALS: ReadonlyArray<readonly [name: string, pattern: RegExp]> = [
  [
    "negative-imperative",
    /(?:^|[^\p{L}\p{N}_])(?:не\s+(?:надо|нужно|запускай|меняй|трогай|делай|используй)|do\s+not|don't)(?=$|[^\p{L}\p{N}_])/iu,
  ],
  [
    "wrong-target",
    /(?:^|[^\p{L}\p{N}_])(?:не\s+(?:тот|та|то|те)|wrong\s+(?:file|directory|command|tool)|not\s+the\s+right)(?=$|[^\p{L}\p{N}_])/iu,
  ],
  [
    "reminder",
    /(?:^|[^\p{L}\p{N}_])(?:я\s+же\s+просил(?:а)?|зачем\s+ты|i\s+(?:already\s+)?asked\s+you|why\s+did\s+you)(?=$|[^\p{L}\p{N}_])/iu,
  ],
  [
    "replacement",
    /(?:^|[^\p{L}\p{N}_])(?:вместо(?=$|[^\p{L}\p{N}_]).{0,80}используй|используй|используйте|use(?=$|[^\p{L}\p{N}_]).{0,80}instead|prefer)(?=$|[^\p{L}\p{N}_])/iu,
  ],
  [
    "durable-language",
    /(?:^|[^\p{L}\p{N}_])(?:всегда|никогда|always|never)(?=$|[^\p{L}\p{N}_])/iu,
  ],
  [
    "workflow-order",
    /(?:^|[^\p{L}\p{N}_])(?:сначала|сперва|first)(?=$|[^\p{L}\p{N}_])/iu,
  ],
];

const ONE_OFF = /(?:^|[^\p{L}\p{N}_])(?:сейчас|пока|в\s+этот\s+раз|только\s+сегодня|for\s+now|right\s+now|this\s+time|today)(?=$|[^\p{L}\p{N}_])/iu;

export function prefilterCorrection(text: string): CorrectionPrefilterResult {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) return { matched: false, signals: [], likelyOneOff: false };
  const signals = SIGNALS.filter(([, pattern]) => pattern.test(normalized)).map(([name]) => name);
  return {
    matched: signals.length > 0,
    signals,
    likelyOneOff: ONE_OFF.test(normalized),
  };
}
