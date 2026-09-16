import { describe, expect, it } from "vitest";
import { highlightLines } from "../src/client/markdown/highlight.js";

/** The `cls:text` pairs of one line, skipping the uncolored runs. */
function tokens(
  lines: readonly (readonly { text: string; cls?: string }[])[],
  index: number,
): string[] {
  return (lines[index] ?? [])
    .filter((span) => span.cls !== undefined)
    .map((span) => `${span.cls}:${span.text}`);
}

describe("fence highlighting", () => {
  it("colors C# keywords, types, strings, comments, and preprocessor lines", () => {
    const lines = highlightLines(
      [
        "#region init",
        "// Было",
        "protected ExampleOrderState() {",
        '    var name = $"x{1}";',
        "    /* многострочный",
        "       комментарий */",
        "}",
      ].join("\n"),
      "csharp",
    );
    expect(tokens(lines, 0)).toEqual(["meta:#region init"]);
    expect(tokens(lines, 1)).toEqual(["comment:// Было"]);
    expect(tokens(lines, 2)).toEqual(["keyword:protected"]);
    expect(tokens(lines, 3)).toEqual(["keyword:var", 'string:$"x{1}"']);
    expect(tokens(lines, 4)).toEqual(["comment:/* многострочный"]);
    expect(tokens(lines, 5)).toEqual(["comment:       комментарий */"]);
    // Highlighting never changes the source: the lines rejoin byte for byte.
    expect(
      lines.map((line) => line.map((span) => span.text).join("")).join("\n"),
    ).toBe(
      [
        "#region init",
        "// Было",
        "protected ExampleOrderState() {",
        '    var name = $"x{1}";',
        "    /* многострочный",
        "       комментарий */",
        "}",
      ].join("\n"),
    );
  });

  it("keeps a fence's source intact for python, sql, and yaml", () => {
    const python = highlightLines(
      'def f(a):\n    """doc"""\n    return a  # хвост\n',
      "python",
    );
    expect(tokens(python, 0)).toEqual(["keyword:def"]);
    expect(tokens(python, 1)).toEqual(['string:"""doc"""']);
    expect(tokens(python, 2)).toEqual(["keyword:return", "comment:# хвост"]);

    const sql = highlightLines("select id from users where name = 'x'", "sql");
    expect(tokens(sql, 0)).toEqual([
      "keyword:select",
      "keyword:from",
      "keyword:where",
      "string:'x'",
    ]);

    const yaml = highlightLines("service:\n  port: 8080\n", "yaml");
    expect(tokens(yaml, 0)).toEqual(["key:service"]);
    expect(tokens(yaml, 1)).toEqual(["key:port", "number:8080"]);
  });

  it("colors JSON keys apart from their string values", () => {
    const lines = highlightLines('{"name": "qa", "on": true}', "json");
    expect(tokens(lines, 0)).toEqual([
      'key:"name"',
      'string:"qa"',
      'key:"on"',
      "constant:true",
    ]);
  });

  it("reads markup tags, attributes, and comments", () => {
    const lines = highlightLines(
      '<a href="/qa" data-x="1">тест</a>\n<!-- заметка -->',
      "html",
    );
    expect(tokens(lines, 0)).toEqual([
      "tag:<a",
      "attr:href",
      'string:"/qa"',
      "attr:data-x",
      'string:"1"',
      "tag:</a",
    ]);
    expect(tokens(lines, 1)).toEqual(["comment:<!-- заметка -->"]);
  });

  it("gives diff lines their role", () => {
    const lines = highlightLines(
      "--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,3 @@\n-старое\n+новое\n контекст",
      "diff",
    );
    expect(tokens(lines, 0)).toEqual(["meta:--- a/x.ts"]);
    expect(tokens(lines, 3)).toEqual(["delete:-старое"]);
    expect(tokens(lines, 4)).toEqual(["insert:+новое"]);
    expect(lines[5]).toEqual([{ text: " контекст" }]);
  });

  it("renders an unknown or absent language as plain text", () => {
    const source = 'какой-то текст: "не строка" // не комментарий';
    for (const lang of [undefined, "", "plain", "brainfuck"]) {
      const lines = highlightLines(source, lang);
      expect(lines).toEqual([[{ text: source }]]);
    }
  });

  it("never lets an unterminated quote swallow the rest of the fence", () => {
    // A lone double quote inside a plain YAML value is common in answers; the
    // next line must still be its own line with its own colors.
    const lines = highlightLines('note: значение "кавычка\nport: 80\n', "yaml");
    expect(lines.length).toBe(3);
    expect(tokens(lines, 1)).toEqual(["key:port", "number:80"]);
  });
});
