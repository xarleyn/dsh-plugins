/**
 * The logs tab type's registration: what it IS.
 *
 * A page, not a viewer: it claims no resource address, because it draws one
 * stream for the whole host rather than a file the user picked. The guide page
 * offers it as an entry box, which is how the panel is opened — the strip's add
 * control asks for the guide, so a type that stays off the guide is a type with
 * no way in.
 */
import type { ReactNode } from "react";
import type { SidebarRightTabDefinition } from "@deepseek-ai/dsh-client-ui-sidebar-right/client";

/** The tab kind this plugin owns. */
export const LOG_PANEL_KIND = "plugin-log";

/** This implementation's identity in the tab system, and the key its body registers under. */
export const LOG_PANEL_ID = "@yadsh/dsh-plugin-log-ui/panel";

/** The guide capsule's glyph: three log lines, shorter at the end. */
function LogLinesGlyph({
  size,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}): ReactNode {
  return (
    <svg
      width={size ?? 16}
      height={size ?? 16}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2.5 4.25h11M2.5 8h11M2.5 11.75h6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The logs type's registry definition.
 *
 * `extension` is the band for a type shipped from outside the product: it is
 * what lets a plugin panel outrank a built-in viewer for an address it claims.
 * The title is a plain string, not a translation: this plugin ships one
 * language, and a locale-registered title would need its own dictionary for a
 * single line.
 * @returns the definition to register.
 */
export function logPanelDefinition(): SidebarRightTabDefinition {
  return {
    id: LOG_PANEL_ID,
    kind: LOG_PANEL_KIND,
    priority: "extension",
    title: () => "Plugin logs",
    guide: [
      {
        // After the workspace files capsule, which opens the column's default tab.
        order: 20,
        title: () => "Plugin logs",
        description: () => "Live output from every registered plugin logger",
        icon: LogLinesGlyph,
      },
    ],
  };
}
