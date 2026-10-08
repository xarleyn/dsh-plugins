import type { ReactNode } from "react";
import {
  QA_THEME_PREFERENCES,
  type QaThemePreference,
} from "../theme-preference.js";

/**
 * The palette choice of the QA surface. Three cubes, like the Host's own
 * Appearance row: the selection is the preference, never the resolved scheme,
 * so «Системная тема» stays pressed while the OS decides which palette that
 * is. Icons only — the row is the header's, and the labels travel as the
 * accessible name and the tooltip instead of eating 200px of it.
 */
export interface QaThemeSwitcherProps {
  readonly preference: QaThemePreference;
  readonly onSelect: (preference: QaThemePreference) => void;
}

const THEME_ICONS: Record<QaThemePreference, ReactNode> = {
  light: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.9v1.6M8 12.5v1.6M1.9 8h1.6M12.5 8h1.6M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M3.7 12.3l1.1-1.1M11.2 4.8l1.1-1.1" />
    </>
  ),
  dark: <path d="M13.1 9.8A5.9 5.9 0 0 1 6.2 2.9a5.9 5.9 0 1 0 6.9 6.9Z" />,
  // The contrast glyph: both palettes, and the OS picks which one is live.
  system: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path
        fill="currentColor"
        stroke="none"
        d="M8 2.25v11.5A5.75 5.75 0 0 0 8 2.25Z"
      />
    </>
  ),
};

const THEME_LABELS: Record<QaThemePreference, string> = {
  light: "Светлая тема",
  dark: "Тёмная тема",
  system: "Системная тема",
};

export function QaThemeSwitcher({
  preference,
  onSelect,
}: QaThemeSwitcherProps) {
  return (
    <div className="dsh-qa-theme" role="group" aria-label="Тема оформления">
      {QA_THEME_PREFERENCES.map((id) => (
        <button
          key={id}
          type="button"
          className="dsh-qa-theme__option"
          title={THEME_LABELS[id]}
          aria-label={THEME_LABELS[id]}
          aria-pressed={preference === id}
          onClick={() => {
            onSelect(id);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {THEME_ICONS[id]}
          </svg>
        </button>
      ))}
    </div>
  );
}
