import type { ReactElement } from "react";

/**
 * The standard disclosure chevron of the shared settings-card shell: a
 * 14x14 inline SVG stroked with `currentColor` (round caps and joins).
 * Font glyphs must not be used for this shape — their appearance and
 * baseline vary by font and encoding.
 *
 * The shell class is the default; a control outside the card body passes its
 * own class and keeps this path, so the shape stays one shape across the UI.
 */
export function ChevronDown({
  className = "dsh-plugin-card__chevron",
}: {
  readonly className?: string;
} = {}): ReactElement {
  return (
    <svg
      className={className}
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
