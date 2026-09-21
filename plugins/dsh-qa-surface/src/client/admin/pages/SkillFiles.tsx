import { useMemo, useState } from "react";
import type { QaAdminSkillScope, QaAdminSkillsView } from "../../../types.js";
import type { QaAdminApi, QaBoundSkillApi, RemoteResult } from "../../types.js";
import { QaSkillsSettingsPage } from "../../user-settings/SkillsSettingsPage.js";
import { ErrorLine, adminErrorMessage, useAdminResource } from "../shared.js";

/** Which store the page is editing, before it becomes a wire scope. */
type ScopeChoice =
  | { readonly kind: "shared" }
  | { readonly kind: "user"; readonly userId: string | null };

function scopeOf(choice: ScopeChoice): QaAdminSkillScope {
  return choice.kind === "shared"
    ? { kind: "shared" }
    : { kind: "user", userId: choice.userId ?? "" };
}

/**
 * What the header shows before a user has been chosen: no store is open yet,
 * and the empty catalog says so without asking the Host for anything.
 */
function emptyView(choice: ScopeChoice): QaAdminSkillsView {
  return { scope: scopeOf(choice), owner: null, skills: [], rootPath: "" };
}

/** How many accounts the picker offers; a deployment's directory is small. */
const PICKER_LIMIT = 100;

export interface AdminSkillFilesProps {
  readonly api: QaAdminApi;
  readonly token: string;
}

/**
 * Skill files: the deployment's shared skills, and the personal skills of one
 * named account.
 *
 * The page is a scope picker around the very component a person edits their
 * own skills with — there is no second editor, because a second editor is a
 * second set of rules for what a `SKILL.md` may contain. What the console adds
 * is the choice of store, the naming of its owner, and the fact that its writes
 * are recorded as an administrator's.
 */
export function AdminSkillFiles(props: AdminSkillFilesProps) {
  const { api, token } = props;
  const [choice, setChoice] = useState<ScopeChoice>({ kind: "shared" });
  const users = useAdminResource(
    () => api.users(token, {}, null, PICKER_LIMIT),
    [api, token],
  );
  const personal = choice.kind === "user";
  const chosen = personal && choice.userId !== null;

  // The header names the store before anyone edits it, and it doubles as this
  // page's authorization probe: a role without `skills.manage` is refused here
  // and the editor is never mounted, so a refusal reads as one line instead of
  // as an editor that fails at everything it tries.
  const view = useAdminResource(
    (): Promise<RemoteResult<QaAdminSkillsView>> =>
      personal && !chosen
        ? Promise.resolve({ ok: true, value: emptyView(choice) })
        : api.skills(token, scopeOf(choice)),
    [api, token, choice, personal, chosen],
  );

  // The editor speaks its own narrow contract; this adapts the console's
  // remotes to it, so the editor never learns who is driving it.
  const skillApi = useMemo((): QaBoundSkillApi => {
    const scope = scopeOf(choice);
    return {
      list: async () => {
        const result = await api.skills(token, scope);
        return result.ok
          ? { ok: true, value: result.value.skills }
          : { ok: false, error: result.error };
      },
      get: (name) => api.skill(token, scope, name),
      create: (input) => api.saveSkill(token, scope, null, input),
      update: (name, input) => api.saveSkill(token, scope, name, input),
      remove: (name, revision) => api.deleteSkill(token, scope, name, revision),
      tools: () => api.skillTools(token, scope),
      validate: (name, input) => api.validateSkill(token, scope, name, input),
    };
  }, [api, token, choice]);

  const failure = view.error ?? users.error;
  // The console's own copy, not the wire message: a refusal carries a stable
  // reason and the browser is the side that knows how to phrase it.
  const headerError =
    failure === undefined ? undefined : adminErrorMessage(failure);
  const ready = headerError === undefined && (chosen || !personal);
  return (
    <section className="dsh-qa-admin__page" aria-label="Редактор навыков">
      <div className="dsh-qa-admin__title-row">
        <div>
          <h1>Редактор навыков</h1>
          <p>
            Общие навыки видны на всём стенде. Личные навыки администратор
            правит от имени владельца — тот увидит пометку «изменено
            администратором». Каждая правка попадает в аудит.
          </p>
        </div>
      </div>
      <div className="dsh-qa-admin__tabs">
        <button
          type="button"
          aria-current={personal ? undefined : "page"}
          onClick={() => setChoice({ kind: "shared" })}
        >
          Общие навыки стенда
        </button>
        <button
          type="button"
          aria-current={personal ? "page" : undefined}
          onClick={() =>
            setChoice((current) => ({
              kind: "user",
              userId: current.kind === "user" ? current.userId : null,
            }))
          }
        >
          Личные навыки пользователя
        </button>
      </div>
      <ErrorLine message={headerError} />
      {personal ? (
        <label className="dsh-qa-admin__filter">
          <span>Пользователь</span>
          <select
            value={choice.userId ?? ""}
            onChange={(event) =>
              setChoice({ kind: "user", userId: event.currentTarget.value })
            }
          >
            <option value="">Выберите пользователя…</option>
            {(users.data?.items ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayName === "" ? row.email : row.displayName} —{" "}
                {row.email}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {view.data === undefined || view.data.rootPath === "" ? null : (
        <p className="dsh-qa-admin__facts">
          <span>
            {view.data.owner === null
              ? "Общее хранилище стенда"
              : `Личное хранилище ${
                  view.data.owner.displayName === ""
                    ? view.data.owner.email
                    : view.data.owner.displayName
                }`}
          </span>
          <span className="dsh-qa-admin__mono" title={view.data.rootPath}>
            {view.data.rootPath}
          </span>
        </p>
      )}
      {personal && !chosen ? (
        <p className="dsh-qa-admin__empty">
          Выберите пользователя, чтобы открыть его личные навыки.
        </p>
      ) : null}
      {ready ? (
        <QaSkillsSettingsPage
          // A different store is a different catalog: remounting drops the
          // loaded document, the draft and the diagnostics of the previous one.
          key={personal ? (choice.userId ?? "personal") : "shared"}
          api={skillApi}
        />
      ) : null}
    </section>
  );
}
