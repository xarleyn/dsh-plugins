import { useSyncExternalStore } from "react";
import type { QaSurfacePanelDefinition } from "./contract.js";
import type { QaSurfacePanelRegistry } from "./registry.js";

function title(definition: QaSurfacePanelDefinition): string {
  try {
    const value = definition.title().trim();
    return value === "" ? definition.kind : value;
  } catch {
    return definition.kind;
  }
}

function PanelIcon({ token }: { readonly token: string | undefined }) {
  switch (token) {
    case "browser":
      return <path d="M2.5 3.25h11v9.5h-11zM2.5 6h11M5 4.6h.01M7 4.6h.01" />;
    case "artifacts":
      return <path d="M3 4.5h4l1.2 1.4H13v6.6H3zM3 4.5V3h3.5l1 1.5" />;
    case "logs":
      return <path d="M3 3.5h10v9H3zM5 6h6M5 8h6M5 10h4" />;
    case "activity":
      return <path d="M2.5 8h2l1.3-3 2.3 6 1.5-4H13.5" />;
    case "terminal":
      return <path d="m3.5 5 2.5 2.5L3.5 10M7.5 10h5" />;
    default:
      return <path d="M5.5 2.75h5v2.5h2.5v5h-2.5v2.5h-5v-2.5H3v-5h2.5zM6.5 6.25h3v3h-3z" />;
  }
}

export function QaPanelLauncher({
  panels,
}: {
  readonly panels: QaSurfacePanelRegistry;
}) {
  const snapshot = useSyncExternalStore(
    panels.subscribe,
    panels.getSnapshot,
    panels.getSnapshot,
  );
  const visible = snapshot.definitions.filter(
    (definition) => definition.userVisible !== false,
  );
  if (visible.length === 0) return null;
  return (
    <nav className="dsh-qa-panel-launcher" aria-label="Панели QA">
      {visible.map((definition) => {
        const label = title(definition);
        const active = snapshot.activeKind === definition.kind;
        return (
          <button
            key={definition.id}
            type="button"
            className="dsh-qa-panel-launcher__button"
            aria-label={`${active ? "Закрыть" : "Открыть"} панель: ${label}`}
            aria-pressed={active}
            title={label}
            onClick={() => panels.toggle(definition.kind)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <PanelIcon token={definition.icon} />
            </svg>
          </button>
        );
      })}
    </nav>
  );
}
