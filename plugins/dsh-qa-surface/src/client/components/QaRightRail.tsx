import type { ReactNode } from "react";
import type { QaRailTab } from "../use-session-ui-state.js";

/** One rail tab's strip chip: label, live count, and its body is the panel. */
export interface QaRailTabModel {
  readonly id: QaRailTab;
  readonly title: string;
  /** Items the tab will show; 0 hides the badge. */
  readonly count: number;
  readonly body: ReactNode;
}

export interface QaRightRailProps {
  readonly tabs: readonly QaRailTabModel[];
  readonly activeTab: QaRailTab;
  readonly onTabSelect: (tab: QaRailTab) => void;
  readonly onClose: () => void;
}

/**
 * The chat's right rail: a fixed column whose top edge is the tab strip,
 * mirroring the Harness right Sidebar's chrome. Tabs are plain chips with
 * counts; the strip's last control collapses the whole column.
 */
export function QaRightRail({
  tabs,
  activeTab,
  onTabSelect,
  onClose,
}: QaRightRailProps) {
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  if (active === undefined) return null;
  return (
    <aside className="dsh-qa-panel" aria-label="Сведения о чате">
      <div
        className="dsh-qa-panel__strip"
        role="tablist"
        aria-label="Вкладки панели"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active.id}
            className={
              tab.id === active.id
                ? "dsh-qa-panel__tab dsh-qa-panel__tab--active"
                : "dsh-qa-panel__tab"
            }
            onClick={() => onTabSelect(tab.id)}
          >
            {tab.title}
            {tab.count > 0 ? <span>{tab.count}</span> : null}
          </button>
        ))}
        <button
          type="button"
          className="dsh-qa-panel__close"
          aria-label="Закрыть панель"
          title="Закрыть"
          onClick={onClose}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      </div>
      <div
        className="dsh-qa-panel__body"
        role="tabpanel"
        aria-label={active.title}
      >
        {active.body}
      </div>
    </aside>
  );
}
