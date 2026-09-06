import type { ReactElement } from "react";

/**
 * The standard disclosure chevron of the shared settings-card shell: a
 * 14x14 inline SVG stroked with `currentColor` (round caps and joins).
 * Font glyphs must not be used for this shape — their appearance and
 * baseline vary by font and encoding.
 */
export function ChevronDown(): ReactElement {
  return (
    <svg
      className="dsh-plugin-card__chevron"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m3.5 5.25 3.5 3.5 3.5-3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
