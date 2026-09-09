/**
 * Bundled prompt profiles (SPEC §14).
 *
 * Each profile is the "Your job" section of the worker prompt; the shared
 * preamble and data boundaries are assembled by `worker/payload.ts`. Custom
 * profiles from config (`prompts.<name>`) override or extend these.
 */

export const BUNDLED_PROMPT_PROFILES: Readonly<Record<string, string>> = {
  generic: [
    "- Extract only the information useful for the parent task.",
    "- Remove repetition and irrelevant boilerplate.",
    "- Preserve exact values, names, paths, and error texts.",
    "- Structure the answer as short sections: Relevant findings, Evidence, Unresolved — skip sections that do not apply.",
  ].join("\n"),

  "code-reader": [
    "- Preserve filenames, symbols, and exact signatures where relevant.",
    "- Preserve line numbers or ranges when the tool result contains them.",
    "- Retain TODO/FIXME markers and error text verbatim where useful.",
    "- Answer the parent task, not \"summarize the file\" generically.",
  ].join("\n"),

  "search-results": [
    "- Deduplicate repeated matches.",
    "- Group matches by file or path.",
    "- Preserve exact matching snippets.",
    "- Identify the strongest likely matches first.",
    "- Do not discard unique matches merely because they look less relevant.",
  ].join("\n"),

  "web-reader": [
    "- Preserve concrete facts and source labels or links present in the tool result.",
    "- Separate directly supported information from inference.",
    "- Do not invent citations.",
  ].join("\n"),

  logs: [
    "- Group repeated stack traces and errors.",
    "- Retain the first and last occurrence of repeated entries.",
    "- Preserve counts.",
    "- Preserve exact exception names, codes, and relevant frames.",
  ].join("\n"),
};
