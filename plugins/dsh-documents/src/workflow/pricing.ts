import {
  WorkflowError,
  type CalculatedCommercial,
  type CommercialLine,
} from "./types.js";

const SCALE = 1_000_000n;
function decimal(value: string, label: string): bigint {
  if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,6})?$/u.test(value)) {
    throw new WorkflowError(
      "INVALID_COMMERCIAL_INPUT",
      `${label} must be a non-negative decimal string with at most six fractional digits`,
    );
  }
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
function money(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

/** Exact decimal multiplication and explicitly defined rounding; no tax rule is inferred. */
export function calculateCommercial(
  lines: readonly CommercialLine[],
  currency: string,
): CalculatedCommercial {
  if (
    !Array.isArray(lines) ||
    lines.length === 0 ||
    lines.length > 200 ||
    !/^[A-Z]{3}$/u.test(currency)
  ) {
    throw new WorkflowError(
      "INVALID_COMMERCIAL_INPUT",
      "provide 1-200 lines and a three-letter currency",
    );
  }
  const ids = new Set<string>();
  let total = 0n;
  const calculated = lines.map((line) => {
    if (
      !line.sku?.trim() ||
      ids.has(line.sku) ||
      !line.title?.trim() ||
      !line.quantitySource?.trim() ||
      !line.priceSource?.trim()
    ) {
      throw new WorkflowError(
        "INVALID_COMMERCIAL_INPUT",
        "each unique SKU needs a title and explicit quantity/price sources",
      );
    }
    ids.add(line.sku);
    const quantity = decimal(line.quantity, "quantity");
    const price = decimal(line.unitPrice, "unitPrice");
    if (quantity === 0n)
      throw new WorkflowError(
        "INVALID_COMMERCIAL_INPUT",
        "quantity must be positive",
      );
    const divisor = (SCALE * SCALE) / 100n;
    const cents = (quantity * price + divisor / 2n) / divisor;
    total += cents;
    return { ...line, total: money(cents) };
  });
  return {
    currency,
    lines: calculated,
    total: money(total),
    rounding: "half-up-per-line-2-decimals",
  };
}
