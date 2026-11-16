/** Validate a comparison expressed with source and destination line numbers.
 * Every supporting line must come from the original extraction and occur in a
 * successful read by this reviewer. Line numbers alone certify nothing. */
export function witnessedLineComparison(
  summary: string,
  source: string,
  target: string,
  pages: ReadonlyMap<string, readonly string[]>,
  windows: ReadonlyMap<string, Set<string>>,
): boolean {
  const pairs = [...summary.matchAll(/\b([SD]\d+)\s+(D\d+)\b/gu)];
  return pairs.some((pair, i) => {
    if (pair[1] !== source || pair[2] !== target) return false;
    const note = summary.slice(
      pair.index + pair[0].length,
      pairs[i + 1]?.index,
    );
    const refs = [
      ...note.matchAll(
        /(?:lines?|строк(?:а|и|ах|е|ам)?)\s*[#:№]?\s*(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)/giu,
      ),
    ];
    if (refs.length < 2) return false;
    if (
      refs
        .slice(2)
        .some(
          (ref, index) =>
            !note
              .slice(
                refs[index + 1]!.index + refs[index + 1]![0].length,
                ref.index,
              )
              .includes(target),
        )
    )
      return false;
    function citedText(key: string, group: string): string {
      const lines = pages.get(key)!,
        seen = windows.get(key)!;
      const found: string[] = [];
      for (const part of group.split(",")) {
        const [start, end = start] = part
          .trim()
          .split(/\s*[-–]\s*/u)
          .map(Number);
        if (
          !start ||
          !end ||
          start > end ||
          end > lines.length ||
          end - start >= 100
        )
          return "";
        for (let row = start; row <= end; row++) {
          const line = lines[row - 1]!;
          if (line && seen.has(line)) found.push(line);
        }
      }
      return found.join(" ");
    }
    const lhs = citedText(source, refs[0]![1]!),
      rhs = refs
        .slice(1)
        .map((ref) => citedText(target, ref[1]!))
        .join(" ");
    const tokenPattern = /[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*/gu;
    const tokens = note.normalize("NFKC").match(tokenPattern) ?? [];
    const words = (text: string) =>
      new Set(text.normalize("NFKC").toLowerCase().match(tokenPattern) ?? []);
    const leftWords = words(lhs),
      rightWords = words(rhs);
    const shared = new Set<string>();
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (!leftWords.has(lower) || !rightWords.has(lower)) continue;
      // A mixed-case product name or alphanumeric equipment designation is
      // distinctive even in a row containing only its name.
      if (
        token.length >= 4 &&
        (/[a-z][A-Z]/u.test(token) ||
          (/\p{L}/u.test(token) && /\d/u.test(token)))
      )
        return true;
      if (
        token.length >= 5 &&
        !/^(?:строк|провер|таблиц|документ|подтверж|испытан|lines?|source|document|table|check)/iu.test(
          token,
        )
      )
        shared.add(lower);
    }
    return shared.size >= 2;
  });
}
