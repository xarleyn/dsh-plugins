import { adfToText, bodyText } from "../../src/providers/jira/adf.js";
import { customFieldValue } from "../../src/providers/jira/operations.js";

describe("atlassian document format", () => {
  it("renders the structure the model needs to read", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Steps" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "run " },
            { type: "text", text: "make test", marks: [{ type: "code" }] },
            {
              type: "text",
              text: " then see ",
            },
            {
              type: "text",
              text: "the runbook",
              marks: [
                { type: "link", attrs: { href: "https://wiki.example/run" } },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { order: 3 },
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "first" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "second" }],
                },
              ],
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "bash" },
          content: [{ type: "text", text: "npm run build" }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "A" }],
                    },
                  ],
                },
                {
                  type: "tableHeader",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "B" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "1" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "2" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "5b10", text: "Alice" } },
            { type: "text", text: " " },
            { type: "emoji", attrs: { shortName: "smile" } },
            { type: "text", text: " status " },
            { type: "status", attrs: { text: "BLOCKED" } },
          ],
        },
      ],
    };
    expect(adfToText(doc, 5_000).text).toBe(
      [
        "## Steps",
        "run `make test` then see [the runbook](https://wiki.example/run)",
        "3. first",
        "4. second",
        "```bash",
        "npm run build",
        "```",
        "| A | B |",
        "| --- | --- |",
        "| 1 | 2 |",
        "@Alice :smile: status `BLOCKED`",
      ].join("\n"),
    );
  });

  it("marks media and cards instead of fetching them", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "mediaSingle",
          content: [
            { type: "media", attrs: { id: "abc", alt: "screenshot.png" } },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "inlineCard", attrs: { url: "https://wiki.example/page" } },
          ],
        },
      ],
    };
    expect(adfToText(doc, 5_000).text).toBe(
      "[media: screenshot.png]\n<https://wiki.example/page>",
    );
  });

  it("bounds the text it hands over and says when it cut", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x".repeat(100) }],
        },
      ],
    };
    expect(adfToText(doc, 10)).toEqual({
      text: "x".repeat(10),
      truncated: true,
    });
    // A plain body takes the same budget; a value that is neither is empty.
    expect(bodyText("y".repeat(50), 10)).toEqual({
      text: "y".repeat(10),
      truncated: true,
    });
    expect(bodyText(42, 10)).toEqual({ text: "", truncated: false });
  });

  it("reduces custom field values to something readable", () => {
    expect(customFieldValue("plain", 10)).toBe("plain");
    expect(customFieldValue(["a", "b"], 10)).toEqual(["a", "b"]);
    expect(customFieldValue({ value: "Gold", id: "5" }, 10)).toEqual({
      id: "5",
      value: "Gold",
    });
    expect(customFieldValue({ unknown: { nested: true } }, 100)).toBe(
      '{"unknown":{"nested":true}}',
    );
    expect(customFieldValue(null, 10)).toBeNull();
  });
});
