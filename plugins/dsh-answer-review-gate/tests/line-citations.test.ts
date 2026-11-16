import { expect, it } from "vitest";
import { witnessedLineComparison } from "../src/line-citations.js";

const pages = new Map([
  ["S1", ["installation requirements", "main database: postgresql"]],
  ["D1", ["verify postgresql connectivity", "run acceptance tests"]],
]);
const windows = new Map([...pages].map(([k, rows]) => [k, new Set(rows)]));
it("accepts an identified product on explicitly cited and observed lines in both files", () => {
  expect(
    witnessedLineComparison(
      "S1 D1 — PostgreSQL from the specification (line 2) is tested in the deliverable (line 1).",
      "S1",
      "D1",
      pages,
      windows,
    ),
  ).toBe(true);
});
it("declines unrelated, out-of-range and unread citations", () => {
  for (const note of [
    "S1 D1 — PostgreSQL (line 1) matches PostgreSQL (line 1)",
    "S1 D1 — PostgreSQL (line 200) is tested (line 1)",
    "S1 D1 — no references for PostgreSQL",
  ])
    expect(witnessedLineComparison(note, "S1", "D1", pages, windows)).toBe(
      false,
    );
  expect(
    witnessedLineComparison(
      "S1 D1 — PostgreSQL (line 2) is tested (line 1)",
      "S1",
      "D1",
      pages,
      new Map([
        ["S1", new Set(["installation requirements"])],
        ["D1", windows.get("D1")!],
      ]),
    ),
  ).toBe(false);
});

it.each(["mysqlrouter", "my-mysql", "mysql2"])(
  "does not certify MySQL from the different product %s",
  (product) => {
    const pages = new Map([
      ["S1", ["required database: mysql"]],
      ["D1", ["installed product: " + product]],
    ]);
    expect(
      witnessedLineComparison(
        "S1 D1 — MySQL (line 1) matches MySQL (line 1)",
        "S1",
        "D1",
        pages,
        new Map([...pages].map(([key, rows]) => [key, new Set(rows)])),
      ),
    ).toBe(false);
  },
);

it("accepts exact product identifiers next to punctuation", () => {
  const pages = new Map([
    ["S1", ["database: mysql (required)"]],
    ["D1", ["verify mysql, then continue"]],
  ]);
  expect(
    witnessedLineComparison(
      "S1 D1 — MySQL (line 1) matches MySQL (line 1)",
      "S1",
      "D1",
      pages,
      new Map([...pages].map(([key, rows]) => [key, new Set(rows)])),
    ),
  ).toBe(true);
});
