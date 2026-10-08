// dsh-session-scope — client copy.
//
// Every string the client renders is written once here as a (zh, en) pair and
// resolved against the browser language, so a control and the row it labels
// cannot answer in two different languages.
const LANG =
  typeof navigator !== "undefined" && /^zh/i.test(navigator.language || "")
    ? "zh"
    : "en";
export function L(zh: string, en: string): string {
  return LANG === "zh" ? zh : en;
}
