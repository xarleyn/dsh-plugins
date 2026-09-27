/**
 * The persona page: the preset roster as cards, each opening its persona
 * editor in the card body.
 *
 * Registered into `settings.section`, beside the deployment's own Agent
 * Presets page. It is a page rather than a configuration card on purpose: the
 * thing it edits is a composition file, not a settings namespace, and its data
 * arrives over this plugin's own Remote namespace.
 * @module client/PersonaPage
 */

import { useEffect, useSyncExternalStore, type ReactElement } from "react";
import type {
  InjectFace,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import { ChevronDown } from "@yadsh/dsh-plugin-kit/client";

import type { PersonaPresetRow } from "../types.js";
import { PersonaEditor } from "./PersonaEditor.js";
import { strings } from "./locale.js";
import type { PersonaPageController, PersonaPageSnapshot } from "./store.js";

/** The page's injected business face. */
export interface PersonaPageInjected {
  readonly controller: PersonaPageController;
}

/** Props of the page, as the settings section renders them. */
export type PersonaPageProps = PropsRuntime<"settings.section"> &
  InjectFace<PersonaPageInjected>;

/** The state badge of one roster row. */
function badgeOf(row: PersonaPresetRow): string {
  if (row.persona === "unreadable") return strings.badgeUnreadable;
  if (row.persona === "ambiguous") return strings.badgeAmbiguous;
  if (row.trust === "system") return strings.badgeShipped;
  return row.persona === "local" ? strings.badgeCustom : strings.badgeInherited;
}

/** The one-line description under a roster row's name. */
function describe(row: PersonaPresetRow): string {
  const parts: string[] = [];
  if (row.persona === "none") parts.push(strings.describesMissing);
  if (row.persona === "ambiguous") parts.push(strings.describesAmbiguous);
  if (row.persona === "unreadable") parts.push(strings.describesError);
  if (row.persona === "local" && row.complete)
    parts.push(strings.describesComplete);
  if (row.isDefault) parts.push(strings.describedDefault);
  if (parts.length === 0) parts.push(row.description);
  return parts.filter((part) => part !== "").join(" · ");
}

/** One roster row: the card shell with the persona reader inside. */
function PresetCard(props: {
  readonly row: PersonaPresetRow;
  readonly state: PersonaPageSnapshot;
  readonly controller: PersonaPageController;
}): ReactElement {
  const { row, state, controller } = props;
  const open = state.open?.id === row.id;
  return (
    <li
      className={
        open ? "dsh-plugin-card dsh-plugin-card--open" : "dsh-plugin-card"
      }
      data-testid="persona-preset-row"
    >
      <button
        type="button"
        className="dsh-plugin-card__header"
        aria-expanded={open}
        aria-label={`${open ? strings.close : strings.open}: ${row.name || row.id}`}
        data-testid="persona-preset-header"
        onClick={() => {
          if (open) controller.close();
          else void controller.open(row.id);
        }}
      >
        <span className="dsh-plugin-card__head-text">
          <span className="dsh-plugin-card__name">{row.name || row.id}</span>
          <span className="dsh-plugin-card__description">{describe(row)}</span>
        </span>
        <span
          className="dsh-plugin-card__badge"
          data-testid="persona-preset-badge"
        >
          {badgeOf(row)}
        </span>
        <ChevronDown />
      </button>
      {open ? (
        <div
          className="dsh-plugin-card__body preset-persona__body"
          data-testid="persona-preset-body"
        >
          <PersonaEditor state={state} controller={controller} />
        </div>
      ) : null}
    </li>
  );
}

/** The page root. */
export function PersonaPage(props: PersonaPageProps): ReactElement {
  const { controller } = props;
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);

  useEffect(() => {
    void controller.load();
  }, [controller]);

  if (state.status === "loading") {
    return (
      <div
        className="preset-persona preset-persona__intro"
        data-testid="persona-loading"
      >
        {strings.loading}
      </div>
    );
  }
  if (state.status === "failed") {
    return (
      <div className="preset-persona" data-testid="persona-load-failed">
        <p className="preset-persona__error" data-testid="persona-load-error">
          {strings.loadFailed} {state.error}
        </p>
        <div className="preset-persona__actions">
          <button
            type="button"
            className="preset-persona__button"
            data-testid="persona-load-reload"
            onClick={() => void controller.load()}
          >
            {strings.reload}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="preset-persona" data-testid="persona-page">
      <p className="preset-persona__intro">{strings.intro}</p>
      {state.notice !== null ? (
        <p
          className={
            state.notice.kind === "error"
              ? "preset-persona__error"
              : state.notice.kind === "warn"
                ? "preset-persona__warn"
                : "preset-persona__ok"
          }
          data-testid="persona-notice"
        >
          {state.notice.text}
        </p>
      ) : null}
      {state.presets.length === 0 ? (
        <p className="preset-persona__intro" data-testid="persona-empty">
          {strings.empty}
        </p>
      ) : (
        <ul className="preset-persona__list" data-testid="persona-roster">
          {state.presets.map((row) => (
            <PresetCard
              key={row.id}
              row={row}
              state={state}
              controller={controller}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
