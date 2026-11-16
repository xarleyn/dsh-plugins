import type { ReactNode } from "react";

const PANELS = {
  agents: {
    label: "Агенты",
    icon: (
      <>
        <rect x="3" y="5.5" width="10" height="7" rx="1.75" />
        <path d="M8 3v2.5M6.2 9h.01M9.8 9h.01M6.2 11h3.6" />
      </>
    ),
  },
  sources: {
    label: "Источники",
    icon: (
      <>
        <circle cx="8" cy="8" r="5.75" />
        <path d="M2.25 8h11.5M8 2.25c1.6 1.55 2.4 3.5 2.4 5.75S9.6 12.2 8 13.75C6.4 12.2 5.6 10.25 5.6 8S6.4 3.8 8 2.25Z" />
      </>
    ),
  },
  files: {
    label: "Файлы",
    icon: (
      <>
        <path d="M9.25 2.5H4.75A1.25 1.25 0 0 0 3.5 3.75v8.5a1.25 1.25 0 0 0 1.25 1.25h6.5a1.25 1.25 0 0 0 1.25-1.25V5.75L9.25 2.5Z" />
        <path d="M9.25 2.5v3.25h3.25M6 8.5h4M6 11h2.5" />
      </>
    ),
  },
} satisfies Record<string, { label: string; icon: ReactNode }>;

export function QaHeaderPanelButton(props: {
  readonly panel: keyof typeof PANELS;
  readonly count?: number | undefined;
  readonly open: boolean;
  readonly disabled?: boolean;
  readonly hint?: string | undefined;
  readonly onClick: () => void;
}) {
  const { label, icon } = PANELS[props.panel];
  const name = props.count === undefined ? label : `${label} (${props.count})`;
  return (
    <button
      type="button"
      className="dsh-qa-header__panel-button"
      data-testid={`qa-surface-header-${props.panel}`}
      aria-label={
        props.hint ? `${name}: ${props.hint.toLocaleLowerCase("ru")}` : name
      }
      title={props.hint ?? name}
      aria-expanded={props.open}
      aria-disabled={props.disabled || undefined}
      onClick={props.disabled ? undefined : props.onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {icon}
      </svg>
      <span className="dsh-qa-header__panel-label">{label}</span>
      {props.count !== undefined && (
        <span className="dsh-qa-header__count">{props.count}</span>
      )}
    </button>
  );
}
