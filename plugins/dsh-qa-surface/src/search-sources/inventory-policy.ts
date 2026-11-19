import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

export type EntryKind = "directory" | "file";
export const fold = (s: string) =>
  s.normalize("NFKC").toLowerCase().replaceAll("ё", "е");

/** Reload at each operation so edited exclusions take effect before the next response. */
export function inventoryPolicy(file: string) {
  const raw = readFileSync(file, "utf8");
  const config = JSON.parse(raw) as Record<string, unknown>;
  function strings(key: string): string[] {
    const value = config[key];
    if (
      !Array.isArray(value) ||
      !value.every((s) => typeof s === "string" && s.trim() && s.length <= 128)
    ) {
      throw new Error("Invalid archive exclusion configuration.");
    }
    return value.map((s: string) => fold(s.trim()));
  }
  function patterns(values: string[]) {
    return values.map(
      (pattern) =>
        new RegExp(
          "^" +
            pattern
              .split("*")
              .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
              .join(".*") +
            "$",
          "u",
        ),
    );
  }
  const sensitive = strings("sensitiveNames");
  const dirs = patterns([...sensitive, ...strings("directories")]);
  const files = patterns([...sensitive, ...strings("files")]);
  const deny = new Set(strings("excludedExtensions"));
  const allow = new Set(strings("allowedExtensions"));
  if (
    !allow.size ||
    [...deny, ...allow].some((s) => !/^\.[a-z0-9]+$/u.test(s))
  ) {
    throw new Error("Invalid archive extension configuration.");
  }
  return {
    digest: createHash("sha256").update(raw).digest("hex"),
    permits(name: string, kind: EntryKind) {
      const normalized = fold(name);
      if (kind === "directory") return !dirs.some((p) => p.test(normalized));
      const ext = extname(normalized);
      return (
        allow.has(ext) &&
        !deny.has(ext) &&
        !files.some((p) => p.test(normalized))
      );
    },
  };
}
export type InventoryPolicy = ReturnType<typeof inventoryPolicy>;
