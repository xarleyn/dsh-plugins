/**
 * Deterministic injection/jailbreak/destructive rules (design SPEC §6, §38).
 *
 * Patterns run against the folded (canonical) text. Every rule requires
 * imperative context where feasible so benign discussion *about* jailbreaks
 * ("the DAN jailbreak was published in 2022") does not trip the scanner —
 * false-positive control matters as much as recall (SPEC §38).
 */

import type { SafetyCategory, SafetyDecision } from "../types.js";

export interface InjectionRule {
  readonly id: string;
  readonly category: SafetyCategory;
  readonly severity: Extract<SafetyDecision, "warn" | "block">;
  /** Rule-author confidence in 0–1, surfaced in verdicts and audit. */
  readonly confidence: number;
  /** Case-insensitive, Unicode-aware source; matched against folded text. */
  readonly source: string;
}

/**
 * Hard red lines: direct attempts to override the assistant's operating
 * instructions or to make it leak its system prompt.
 */
export const INJECTION_RULES: readonly InjectionRule[] = [
  {
    id: "injection.ignore_previous",
    category: "prompt_injection",
    severity: "block",
    confidence: 0.9,
    source: "\\b(?:ignore|disregard|forget|discard)\\s+(?:all\\s+|any\\s+|the\\s+|your\\s+)?(?:previous|prior|above|earlier|preceding|past)\\s+(?:instructions?|prompts?|messages?|directions?|rules)\\b",
  },
  {
    id: "injection.override_restrictions",
    category: "jailbreak",
    severity: "block",
    confidence: 0.9,
    source: "\\b(?:ignore|disregard|bypass|override|break|get\\s+rid\\s+of|disable)\\s+(?:all\\s+|any\\s+|the\\s+|your\\s+)?(?:safety|content|ethical|moral|safety\\s+guard)?(?:guardrails?|restrictions|filters?|guidelines|policies|constraints|rules)\\b",
  },
  {
    id: "injection.system_prompt_extraction",
    category: "prompt_injection",
    severity: "block",
    confidence: 0.85,
    source: "\\b(?:reveal|print|repeat|show|output|display|leak|expose|copy|paste|share|recite|quote)\\b[^.]{0,40}\\b(?:system\\s*prompt|initial\\s+instructions?|hidden\\s+instructions?|your\\s+(?:original\\s+)?instructions?|system\\s+message)\\b",
  },
  {
    id: "injection.new_instructions",
    category: "prompt_injection",
    severity: "warn",
    confidence: 0.55,
    source: "\\b(?:new|updated|revised)\\s+(?:system\\s+)?(?:instructions?|directives?|operating\\s+rules)\\s*(?:from\\s+now\\s+on)?\\s*:",
  },
  {
    id: "jailbreak.do_anything_now",
    category: "jailbreak",
    severity: "block",
    confidence: 0.85,
    source: "\\b(?:do\\s+anything\\s+now|dan\\s+mode|developer\\s+mode\\s+(?:enabled|on)|god\\s+mode\\s+on|jailbreak\\s+(?:yourself|the\\s+(?:model|ai|assistant|filter)))\\b",
  },
  {
    id: "jailbreak.unrestricted_persona",
    category: "jailbreak",
    severity: "block",
    confidence: 0.8,
    source: "\\b(?:you\\s+are|act\\s+as(?:\\s+if\\s+you\\s+(?:are|were))?|pretend\\s+(?:that\\s+)?you\\s+are|from\\s+now\\s+on\\s+you\\s+are)\\s+(?:an?\\s+)?(?:unrestricted|uncensored|unfiltered|unethical|amoral|evil|villain|criminal)\\s+(?:ai|assistant|chatbot|model|persona|version)\\b",
  },
  {
    id: "jailbreak.no_restrictions_request",
    category: "jailbreak",
    severity: "warn",
    confidence: 0.6,
    source: "\\b(?:respond|answer|reply|write)\\s+(?:without|with\\s+no)\\s+(?:any\\s+)?(?:restrictions|filters|limitations|content\\s+policy|moral\\s+filters?|ethics)\\b",
  },
  {
    id: "jailbreak.ru_ignore_instructions",
    category: "prompt_injection",
    severity: "block",
    confidence: 0.85,
    source: "(?:игнорир(?:уй|уйте|овать)|забудь|забудьте|проигнорир(?:уй|уйте))\\s+(?:все\\s+|любые\\s+|свои\\s+)?(?:предыдущие|прошлые|прежние)\\s+(?:инструкции|указания|правила|промпты)",
  },
  {
    id: "jailbreak.ru_unrestricted_persona",
    category: "jailbreak",
    severity: "block",
    confidence: 0.8,
    source: "(?:ты|вы)\\s+(?:теперь|более\\s+не)\\s+(?:не\\s+)?(?:свобод(?:ен|на)\\s+от\\s+(?:правил|ограничений)|без\\s+(?:ограничений|фильтров|запретов)|дан|dan)",
  },
  {
    id: "exfiltration.credential_transfer",
    category: "credential_exfiltration",
    severity: "warn",
    confidence: 0.6,
    source: "\\b(?:send|post|upload|forward|transfer|exfiltrate|вышли|отправь|отправить|загрузи)\\b[^.]{0,60}\\b(?:api[\\s_-]?keys?|tokens?|passwords?|passphrases?|credentials?|secrets?|\\.env|ключи?|пароли?|токены?)\\b",
  },
  {
    id: "destructive.fork_bomb",
    category: "destructive_intent",
    severity: "block",
    confidence: 0.9,
    source: ":\\(\\)\\s*\\{\\s*:\\s*\\|\\s*:\\s*&\\s*\\}\\s*;\\s*:",
  },
  {
    id: "destructive.wipe_commands",
    category: "destructive_intent",
    severity: "block",
    confidence: 0.85,
    source: "(?:\\brm\\s+-(?:[a-z]*r[a-z]*f|f[a-z]*r[a-z]*)\\s+/(?:\\s|$)|\\bmkfs(?:\\.\\w+)?\\s+/|\\bdd\\s+if=/dev/(?:zero|random)\\s+of=/dev/(?:sd|nvme|hd)|\\bformat\\s+c:|\\bdel\\s+/[sq]\\s+c:\\\\|\\bchmod\\s+-R\\s+777\\s+/)",
  },
  {
    id: "unsafe.pipe_to_shell",
    category: "unsafe_tool_intent",
    severity: "block",
    confidence: 0.85,
    source: "\\b(?:curl|wget|Invoke-WebRequest|iwr|irm)\\b[^|;]{0,120}\\|\\s*(?:sudo\\s+)?(?:sh|bash|zsh|fish|powershell|pwsh|cmd|python3?|iex|perl|ruby)\\b",
  },
  {
    id: "unsafe.reverse_shell",
    category: "unsafe_tool_intent",
    severity: "block",
    confidence: 0.85,
    source: "\\b(?:nc|ncat|netcat)\\s+(?:-e\\s+)?/?(?:bin/)?(?:ba)?sh\\b|\\bmkfifo\\b[^;]{0,80}\\b(?:nc|ncat|netcat)\\b|/dev/tcp/[\\w.-]+/\\d+",
  },
] as const;

/** Compile a rule into a case-insensitive RegExp (thrown invalid at load). */
export function compileInjectionRule(rule: InjectionRule): RegExp {
  return new RegExp(rule.source, "iu");
}
