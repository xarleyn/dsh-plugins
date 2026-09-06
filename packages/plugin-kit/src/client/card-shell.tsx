import { useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown } from "./chevron.js";

/** Props of the shared settings-plugin card shell. */
export interface CardShellProps {
  /** Card title, rendered as the `__name` line of the header stack. */
  readonly title: ReactNode;
  /** Card description, rendered as the `__description` line of the stack. */
  readonly description: ReactNode;
  /**
   * Optional status badge after the title stack (unsaved marker, live
   * counters, ...). Rendered only when defined.
   */
  readonly badge?: ReactNode;
  /**
   * Accessible show/hide label of the header toggle; called with the open
   * state so plugins keep their localized wording.
   */
  readonly label: (open: boolean) => string;
  /** Extra class names for the body element (plugin body styles). */
  readonly bodyClassName?: string;
  /** Body content, rendered only while the card is open. */
  readonly children?: ReactNode;
}

/**
 * Shared outer shell of a plugin configuration card (AGENTS.md contract): a
 * direct `<li>` child of the host list with a full-width header button
 * (`type="button"`, `aria-expanded`, accessible show/hide label, the
 * title/description stack, an optional status badge, then the chevron) and a
 * body rendered only while open. Plugin-specific controls belong inside the
 * body and must not restyle the shell.
 */
export function CardShell(props: CardShellProps): ReactElement {
  const [open, setOpen] = useState(false);
  const body =
    props.bodyClassName === undefined
      ? "dsh-plugin-card__body"
      : `dsh-plugin-card__body ${props.bodyClassName}`;
  return (
    <li
      className={
        open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card"
      }
    >
      <button
        type="button"
        className="dsh-plugin-card__header"
        aria-expanded={open}
        aria-label={props.label(open)}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="dsh-plugin-card__head-text">
          <span className="dsh-plugin-card__name">{props.title}</span>
          <span className="dsh-plugin-card__description">
            {props.description}
          </span>
        </span>
        {props.badge ?? null}
        <ChevronDown />
      </button>
      {open ? <div className={body}>{props.children}</div> : null}
    </li>
  );
}
