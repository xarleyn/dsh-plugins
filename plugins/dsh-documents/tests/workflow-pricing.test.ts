import { describe, expect, it } from "vitest";
import { calculateCommercial } from "../src/workflow/pricing.js";
import type { CommercialLine } from "../src/workflow/types.js";

function line(
  quantity: string,
  unitPrice: string,
  sku = "demo",
): CommercialLine {
  return {
    sku,
    title: "Демо-позиция",
    quantity,
    unitPrice,
    quantitySource: "human:1",
    priceSource: "approved-catalog:demo",
  };
}
describe("exact commercial arithmetic", () => {
  it.each([
    ["0.1", "0.2", "0.02"],
    ["1", "0.005", "0.01"],
    ["3", "19.995", "59.99"],
    ["2.5", "100.01", "250.03"],
    ["999999999999", "999999999999", "999999999998000000000001.00"],
  ])("calculates %s × %s as %s", (quantity, price, expected) => {
    expect(calculateCommercial([line(quantity, price)], "RUB").total).toBe(
      expected,
    );
  });
  it("sums rounded lines using integer cents", () => {
    const result = calculateCommercial(
      [line("1", "0.005", "a"), line("1", "0.005", "b")],
      "RUB",
    );
    expect(result.lines.map((l) => l.total)).toEqual(["0.01", "0.01"]);
    expect(result.total).toBe("0.02");
    expect(result.rounding).toBe("half-up-per-line-2-decimals");
  });
  it("requires explicit sources and refuses malformed/negative/duplicate values", () => {
    for (const value of ["-1", "1e3", "NaN", "1,20", "1.0000001", ""])
      expect(() => calculateCommercial([line("1", value)], "RUB")).toThrow();
    expect(() =>
      calculateCommercial([{ ...line("1", "10"), priceSource: "" }], "RUB"),
    ).toThrow();
    expect(() => calculateCommercial([line("0", "10")], "RUB")).toThrow();
    expect(() =>
      calculateCommercial([line("1", "10"), line("2", "10")], "RUB"),
    ).toThrow();
  });
});
