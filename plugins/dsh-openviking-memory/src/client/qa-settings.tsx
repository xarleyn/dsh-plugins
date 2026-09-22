/**
 * The account-scoped page of the QA settings dialog.
 *
 * This is the surface a signed-in user reaches on a QA deployment, and what it
 * answers is a question about *them*: what the assistant remembers about this
 * account, and which conversations it learned that from. The Host's own "Plugin
 * configuration" card cannot be it — those cards are discovered from the Host
 * settings directory, which a browser reaching the deployment over the network
 * never gets, and the QA overlay does not render the native settings tree at
 * all.
 *
 * It is deliberately read-only. Whether the assistant uses the memory at all is
 * the deployment's decision, taken where the deployment's configuration lives;
 * a person's settings dialog is the wrong place to switch the product's memory
 * off, and the right place to show them what it holds.
 */

import type { RemoteResult } from "@deepseek-ai/dsh-typert-protocol";
import type { QaUserSettingsSectionProps } from "@yadsh/dsh-qa-surface/client/settings";
import { useCallback, useEffect, useState } from "react";

import type { QaMemoryOverviewGroup, QaUserMemoryOverview } from "../types.js";

/** The Remote surface this page calls; the token authenticates the caller. */
export interface MemoryOverviewRemote {
  userMemoryOverview(
    token: string,
  ): Promise<RemoteResult<QaUserMemoryOverview>>;
}

/** The section id and title QA Surface registers this page under. */
export const QA_MEMORY_SECTION_ID = "openviking-memory";
export const QA_MEMORY_SECTION_TITLE = "Память";

/**
 * Section stylesheet, built only from `--dsw-alias-*` tokens so the page
 * follows the dialog's light, dark, and system themes.
 */
export const qaSettingsStyles: string = `
.ovm-qa,.ovm-qa *{box-sizing:border-box}
.ovm-qa{display:grid;gap:14px;color:var(--dsw-alias-label-primary);font-size:13px}
.ovm-qa__lead{margin:0;color:var(--dsw-alias-label-secondary);line-height:1.5}
.ovm-qa__facts{display:flex;flex-wrap:wrap;gap:6px}
.ovm-qa__fact{display:grid;gap:2px;padding:8px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;min-width:86px}
.ovm-qa__fact b{font-size:16px;font-weight:600;line-height:1.2}
.ovm-qa__fact span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.ovm-qa__block{display:grid;gap:8px}
.ovm-qa__block-title{margin:0;font-size:13px;font-weight:600}
.ovm-qa__block-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.45}
.ovm-qa__card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:grid;gap:6px}
.ovm-qa__card-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
.ovm-qa__card-name{font-size:13px;font-weight:600}
.ovm-qa__card-count{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.ovm-qa__card-summary{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
.ovm-qa__items{display:grid;gap:5px;margin:0;padding:0;list-style:none}
.ovm-qa__item{display:grid;gap:2px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l2)}
.ovm-qa__item-name{font-size:12px;font-weight:600}
.ovm-qa__item-summary{font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.45}
.ovm-qa__profile{margin:0;white-space:pre-wrap;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;max-height:220px;overflow:auto;font-family:inherit}
.ovm-qa__chats{display:grid;gap:8px;margin:0;padding:0;list-style:none}
.ovm-qa__chat{display:grid;gap:2px}
.ovm-qa__chat-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;gap:8px;flex-wrap:wrap}
.ovm-qa__chat-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ovm-qa__notice{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}
.ovm-qa__notice strong{color:var(--dsw-alias-label-primary)}
.ovm-qa__error{margin:0;padding:10px 12px;border-radius:9px;background:var(--dsw-alias-bg-error);color:var(--dsw-alias-label-error);font-size:11px;line-height:1.5}
.ovm-qa__footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ovm-qa__btn{height:32px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:0 12px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.ovm-qa__btn:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-interactive-bg-hover)}
.ovm-qa__btn:disabled{cursor:default;opacity:.45}
.ovm-qa__muted{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}
`;

/** The message a refused Remote call shows; the wire carries no detail. */
const GENERIC_FAILURE =
  "Не удалось прочитать память. Обновите страницу и попробуйте снова.";

function failureMessage(result: RemoteResult<unknown>): string {
  if (!result.ok && typeof result.error?.message === "string") {
    return result.error.message;
  }
  return GENERIC_FAILURE;
}

/** A stored timestamp, as the page prints it; an unreadable one is left out. */
function formatTime(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One remembered entry: its name, and the store's note about it. */
function MemoryItem(props: {
  readonly name: string;
  readonly summary: string;
  readonly folder: boolean;
}): React.JSX.Element {
  return (
    <li className="ovm-qa__item">
      <span className="ovm-qa__item-name">
        {props.folder ? `${props.name}/` : props.name}
      </span>
      {props.summary === "" ? null : (
        <span className="ovm-qa__item-summary">{props.summary}</span>
      )}
    </li>
  );
}

/** One memory section: what it covers, and the first of its entries. */
function MemoryGroup(props: {
  readonly group: QaMemoryOverviewGroup;
}): React.JSX.Element {
  const hidden = props.group.total - props.group.items.length;
  return (
    <div className="ovm-qa__card">
      <div className="ovm-qa__card-head">
        <span className="ovm-qa__card-name">{props.group.title}</span>
        <span className="ovm-qa__card-count">
          {props.group.total === 1
            ? "1 запись"
            : `${props.group.total} записей`}
        </span>
      </div>
      {props.group.summary === "" ? null : (
        <p className="ovm-qa__card-summary">{props.group.summary}</p>
      )}
      <ul className="ovm-qa__items">
        {props.group.items.map((item) => (
          <MemoryItem
            key={`${props.group.name}:${item.name}`}
            name={item.name}
            summary={item.summary}
            folder={item.folder}
          />
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="ovm-qa__muted">
          Показаны первые {props.group.items.length}; всего {props.group.total}.
        </p>
      ) : null}
    </div>
  );
}

/** The memory of one account, as its page reads it. */
function MemoryOverview(props: {
  readonly overview: QaUserMemoryOverview;
}): React.JSX.Element {
  const view = props.overview;
  if (!view.connected) {
    return (
      <p className="ovm-qa__error">
        Память недоступна: {view.error ?? "сервер не ответил"}. Разговоры при
        этом продолжают записываться, как только он вернётся.
      </p>
    );
  }

  const empty =
    view.groups.length === 0 &&
    view.sessions.length === 0 &&
    view.profile === null;

  return (
    <>
      <div className="ovm-qa__facts">
        <div className="ovm-qa__fact">
          <b>{view.totals.sections}</b>
          <span>разделов</span>
        </div>
        <div className="ovm-qa__fact">
          <b>{view.totals.memories}</b>
          <span>записей</span>
        </div>
        <div className="ovm-qa__fact">
          <b>{view.totals.sessions}</b>
          <span>разговоров</span>
        </div>
      </div>

      {view.scoped && !view.accountApplies ? (
        <p className="ovm-qa__notice">
          Развёртывание настроено разделять память по учётным записям, но сервер
          памяти его не применяет
          {view.serverIdentity === ""
            ? ""
            : `: на запросы он отвечает как «${view.serverIdentity}»`}
          . Поэтому здесь видно общую память стенда, а не только вашу.
        </p>
      ) : null}

      {!view.scoped ? (
        <p className="ovm-qa__notice">
          Разделение памяти по пользователям в этом развёртывании выключено: все
          аккаунты пользуются одной памятью.
        </p>
      ) : null}

      {empty ? (
        <p className="ovm-qa__muted">
          Память пока пуста: она наполнится по мере разговоров.
        </p>
      ) : null}

      {view.profile === null ? null : (
        <div className="ovm-qa__block">
          <h4 className="ovm-qa__block-title">Что ассистент о вас знает</h4>
          <pre className="ovm-qa__profile">{view.profile.text}</pre>
          <p className="ovm-qa__muted">
            Из файла {view.profile.name}
            {view.profile.truncated ? "; показаны только первые символы" : ""}.
          </p>
        </div>
      )}

      {view.groups.length === 0 ? null : (
        <div className="ovm-qa__block">
          <h4 className="ovm-qa__block-title">Что запомнено</h4>
          <p className="ovm-qa__block-hint">
            Записи, которые ассистент сделал по ходу разговоров.
          </p>
          {view.groups.map((group) => (
            <MemoryGroup key={group.name} group={group} />
          ))}
        </div>
      )}

      {view.sessions.length === 0 ? null : (
        <div className="ovm-qa__block">
          <h4 className="ovm-qa__block-title">Прошлые разговоры</h4>
          <ul className="ovm-qa__chats">
            {view.sessions.map((session) => (
              <li className="ovm-qa__chat" key={session.id}>
                <span className="ovm-qa__chat-meta">
                  <span className="ovm-qa__chat-id">
                    {session.id.slice(0, 8)}
                  </span>
                  <span>{formatTime(session.updatedAt) ?? "без даты"}</span>
                </span>
                <span className="ovm-qa__item-summary">
                  {session.summary === ""
                    ? "Память не оставила описания этого разговора."
                    : session.summary}
                </span>
              </li>
            ))}
          </ul>
          {view.totals.sessions > view.sessions.length ? (
            <p className="ovm-qa__muted">
              Показаны последние {view.sessions.length} из{" "}
              {view.totals.sessions}.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

/**
 * Build the page component around one mounted Remote namespace. The token
 * arrives from the dialog as transport authentication; it is never stored.
 */
export function createMemoryOverviewSection(remote: MemoryOverviewRemote) {
  return function MemoryOverviewSection({
    token,
  }: QaUserSettingsSectionProps): React.JSX.Element {
    const [overview, setOverview] = useState<QaUserMemoryOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
      setBusy(true);
      try {
        const result = await remote.userMemoryOverview(token);
        if (result.ok) {
          setOverview(result.value);
          setError(null);
        } else {
          setOverview(null);
          setError(failureMessage(result));
        }
      } catch {
        setOverview(null);
        setError(GENERIC_FAILURE);
      } finally {
        setBusy(false);
      }
    }, [remote, token]);

    useEffect(() => {
      void load();
    }, [load]);

    return (
      <section className="ovm-qa" aria-label="Память OpenViking">
        <p className="ovm-qa__lead">
          Память ассистента — то, что он сохранил из ваших разговоров. Эта
          страница только читает: память наполняется самими разговорами, а
          автоподстановку в ответы задаёт развёртывание.
        </p>

        {error !== null ? <p className="ovm-qa__error">{error}</p> : null}

        {overview !== null ? (
          <MemoryOverview overview={overview} />
        ) : error === null ? (
          <p className="ovm-qa__muted">Читаю память…</p>
        ) : null}

        <div className="ovm-qa__footer">
          <p className="ovm-qa__muted">
            {overview === null || !overview.connected
              ? "Память OpenViking"
              : overview.scoped && overview.accountApplies
                ? "Память разделена по учётным записям QA."
                : "Разделение по учётным записям не действует: память общая."}
          </p>
          <button
            type="button"
            className="ovm-qa__btn"
            disabled={busy}
            onClick={() => {
              void load();
            }}
          >
            Обновить
          </button>
        </div>
      </section>
    );
  };
}
