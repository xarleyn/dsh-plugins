/** Read an Atlassian Document Format calendar date as a UTC date. */
export function adfDate(timestamp: unknown): string {
  let milliseconds: number;
  if (typeof timestamp === "number") {
    milliseconds = timestamp;
  } else if (typeof timestamp === "string" && /^-?\d+$/u.test(timestamp)) {
    // Cloud documents seconds; editor exports also use milliseconds. For
    // ambiguous strings, up to ten digits (ignoring the sign) mean seconds.
    // Numeric inputs retain the existing millisecond convention.
    milliseconds = Number(timestamp);
    if (/^-?\d{1,10}$/u.test(timestamp)) milliseconds *= 1_000;
  } else {
    return "[date]";
  }
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return "[date]";
  const iso = date.toISOString();
  return iso.slice(0, iso.indexOf("T"));
}
