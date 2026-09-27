/**
 * The banner that explains a page the policy would not load.
 *
 * Which refusals are worth a banner, and what the headline says, is decided in
 * `panel-view.ts`; this component only renders the list the operator acts on —
 * the destination, the kind of request, and the setting that would allow it.
 */
import type { BrowserPolicyRefusal } from "../types.js";
import { refusalKindLabel } from "./panel-view.js";

export interface BrowserRefusalsProps {
  readonly headline: string;
  readonly leadMessage: string | undefined;
  readonly refusals: readonly BrowserPolicyRefusal[];
}

export function BrowserRefusals({
  headline,
  leadMessage,
  refusals,
}: BrowserRefusalsProps) {
  return (
    <div
      className="dsh-qa-browser-panel__refusal"
      data-testid="panel-refusal"
      role="alert"
    >
      <p
        className="dsh-qa-browser-panel__refusal-title"
        data-testid="panel-refusal-title"
      >
        {headline}
      </p>
      <ul
        className="dsh-qa-browser-panel__refusal-list"
        data-testid="panel-refusal-list"
      >
        {refusals.map((entry, index) => (
          <li
            className="dsh-qa-browser-panel__refusal-item"
            data-testid="panel-refusal-item"
            key={`${String(index)}:${entry.kind}:${entry.code}:${entry.host}`}
          >
            <span
              className="dsh-qa-browser-panel__refusal-host"
              data-testid="panel-refusal-host"
            >
              {entry.host}
            </span>
            <span
              className="dsh-qa-browser-panel__refusal-kind"
              data-testid="panel-refusal-kind"
            >
              {refusalKindLabel(entry)}
            </span>
          </li>
        ))}
      </ul>
      <p
        className="dsh-qa-browser-panel__refusal-text"
        data-testid="panel-refusal-message"
      >
        {leadMessage}
      </p>
      {/*
        The refusal names the setting; what it cannot say is which of the
        two ways to open the deployment is the sane one, and that is the
        operator's decision to make here rather than in the chat.
      */}
      <p
        className="dsh-qa-browser-panel__refusal-hint"
        data-testid="panel-refusal-hint"
      >
        Это настройка контура, а не чата: точечно — добавить узел в
        security.network.allowHosts, широко — включить
        security.network.allowPrivateNetworks для всей приватной сети.
      </p>
    </div>
  );
}
