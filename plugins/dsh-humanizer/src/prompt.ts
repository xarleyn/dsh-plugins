/** Author prompt, pinned to HF revision 7232532cb8466bd393544e97826e12e6b5e471ac.
 * Source: https://huggingface.co/jialinyyzz/humanizer/blob/7232532cb8466bd393544e97826e12e6b5e471ac/prompt_format.json
 * Draft X must have sha256 prefix cc51d66b4c593fbe.
 */
export const INSTRUCTION = [
  "Rewrite the text below so it reads like a person wrote it, not a language model.",
  "",
  "Reorganize it as you see fit. Vary sentence length on purpose. Cut hedging,",
  "throat-clearing, and any sentence that only announces what comes next.",
  "Prefer the concrete word over the abstract one. It is fine to sound uneven.",
  "",
  "Every fact, number, unit, date, name and quotation must survive unchanged.",
].join("\n");

export function buildPrompt(draft: string): string {
  return INSTRUCTION + "\n\n" + draft.trim() + "\n\n### Rewritten:\n\n";
}
