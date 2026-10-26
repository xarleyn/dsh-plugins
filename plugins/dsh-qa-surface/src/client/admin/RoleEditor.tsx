import { useState } from "react";
import type {
  QaCapabilityDescriptor,
  QaCapabilitySelection,
  QaSkillAccess,
  QaSubrole,
} from "../../types.js";
import type { QaAccessApi } from "../types.js";
import { CapabilityPicker } from "./CapabilityPicker.js";
import { ModelPolicyEditor } from "./ModelPolicyEditor.js";
import {
  emptyRole,
  roleEffective,
  unique,
  TOOL_BUCKET_LABELS,
  type ToolBucket,
} from "./capability-selection.js";

export function RoleEditor(props: {
  readonly role: QaSubrole | null;
  readonly api: QaAccessApi;
  readonly token: string;
  readonly catalog: readonly QaCapabilityDescriptor[];
  readonly common: QaCapabilitySelection;
  readonly system: QaCapabilitySelection;
  readonly skills: readonly QaSkillAccess[];
  readonly subroles: readonly QaSubrole[];
  readonly onCancel: () => void;
  readonly onSave: (role: QaSubrole) => Promise<void>;
}) {
  const existing = props.role !== null;
  const [draft, setDraft] = useState<QaSubrole>(props.role ?? emptyRole());
  const [tab, setTab] = useState<
    "general" | "model" | "tools" | "skills" | "effective"
  >("general");
  const [saving, setSaving] = useState(false);
  const setSkills = (values: readonly string[]) =>
    setDraft((current) => ({
      ...current,
      capabilities: { ...current.capabilities, skills: values },
    }));
  const setTools = (bucket: ToolBucket, values: readonly string[]) =>
    setDraft((current) => ({
      ...current,
      capabilities: {
        ...current.capabilities,
        tools: { ...current.capabilities.tools, [bucket]: values },
      },
    }));
  const effective = roleEffective(
    {
      system: props.system,
      common: props.common,
      role: draft.capabilities,
      skills: props.skills,
    },
    draft.id,
  );
  const declaredSkills = props.skills.filter(({ name }) =>
    effective.declared.includes(name),
  );
  return (
    <section className="dsh-qa-role-editor" data-testid="qa-admin-role-editor">
      <div className="dsh-qa-admin__title-row">
        <div>
          <button
            type="button"
            className="dsh-qa-admin__back"
            data-testid="qa-admin-role-back"
            onClick={props.onCancel}
          >
            ← Саброли
          </button>
          <h2>{existing ? draft.name : "Новая саброль"}</h2>
          <p>{draft.description || "Профиль возможностей QA-ассистента"}</p>
        </div>
      </div>
      <div className="dsh-qa-admin__tabs" data-testid="qa-admin-role-tabs">
        {(
          [
            ["general", "Общее"],
            ["model", "Модель"],
            ["tools", "Инструменты"],
            ["skills", "Навыки"],
            ["effective", "Фактический доступ"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`qa-admin-role-tab-${id}`}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "general" ? (
        <div
          className="dsh-qa-role-editor__general"
          data-testid="qa-admin-role-general"
        >
          <label data-testid="qa-admin-role-name-field">
            Название
            <input
              data-testid="qa-admin-role-name"
              value={draft.name}
              maxLength={100}
              onChange={(event) =>
                setDraft({ ...draft, name: event.currentTarget.value })
              }
            />
          </label>
          <label data-testid="qa-admin-role-slug-field">
            Slug / ID
            <input
              data-testid="qa-admin-role-slug"
              value={draft.id}
              disabled={existing}
              pattern="[a-z0-9][a-z0-9-]*"
              onChange={(event) =>
                setDraft({ ...draft, id: event.currentTarget.value })
              }
            />
          </label>
          <label
            className="dsh-qa-role-editor__wide"
            data-testid="qa-admin-role-description-field"
          >
            Описание
            <textarea
              data-testid="qa-admin-role-description"
              value={draft.description ?? ""}
              maxLength={500}
              onChange={(event) =>
                setDraft({ ...draft, description: event.currentTarget.value })
              }
            />
          </label>
          <label
            className="dsh-qa-role-editor__check"
            data-testid="qa-admin-role-enabled-field"
          >
            <input
              type="checkbox"
              data-testid="qa-admin-role-enabled"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft({ ...draft, enabled: event.currentTarget.checked })
              }
            />
            Включена
          </label>
        </div>
      ) : tab === "model" ? (
        <div data-testid="qa-admin-role-model-panel">
          <ModelPolicyEditor
            api={props.api}
            token={props.token}
            disabled={saving}
            testId="qa-admin-role-model"
            value={draft.model}
            onChange={(model) => setDraft({ ...draft, model })}
          />
        </div>
      ) : tab === "tools" ? (
        <div
          className="dsh-qa-tool-buckets"
          data-testid="qa-admin-role-tool-buckets"
        >
          <section data-testid="qa-admin-role-bucket-always">
            <h3>{TOOL_BUCKET_LABELS.always}</h3>
            <p>Видны агенту с первого шага разговора.</p>
            <CapabilityPicker
              type="tool"
              testId="qa-admin-role-tools-always"
              catalog={props.catalog}
              inherited={props.common.tools.always}
              system={props.system.tools.always}
              selected={draft.capabilities.tools.always}
              onChange={(values) => setTools("always", values)}
            />
          </section>
          <section data-testid="qa-admin-role-bucket-skill-grantable">
            <h3>{TOOL_BUCKET_LABELS.skillGrantable}</h3>
            <p>
              Эти инструменты не показываются агенту по умолчанию. Они
              становятся доступны, когда активируется разрешённый навык,
              которому они нужны.
            </p>
            <CapabilityPicker
              type="tool"
              testId="qa-admin-role-tools-skill-grantable"
              catalog={props.catalog}
              inherited={props.common.tools.skillGrantable}
              system={props.system.tools.skillGrantable}
              selected={draft.capabilities.tools.skillGrantable}
              onChange={(values) => setTools("skillGrantable", values)}
            />
            {effective.via.size === 0 ? null : (
              <div
                className="dsh-qa-skill-grants"
                data-testid="qa-admin-role-skill-grants"
              >
                <h4>Используют назначенные навыки</h4>
                <ul data-testid="qa-admin-role-skill-grant-list">
                  {[...effective.via].map(([tool, skills]) => (
                    <li key={tool} data-testid="qa-admin-role-skill-grant">
                      <code>{tool}</code>
                      <span>Доступен через: {skills.join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section data-testid="qa-admin-role-bucket-deny">
            <h3>{TOOL_BUCKET_LABELS.deny}</h3>
            <p>
              Инструменты, которые снимаются с этой саброли, даже если их выдают
              системный набор стенда, общие возможности или навык. Запрет
              сильнее любой выдачи и сужает набор, доступный делегированным
              экспертам.
            </p>
            <CapabilityPicker
              type="tool"
              testId="qa-admin-role-tools-deny"
              catalog={props.catalog}
              selected={draft.capabilities.tools.deny ?? []}
              onChange={(values) => setTools("deny", values)}
            />
          </section>
        </div>
      ) : tab === "skills" ? (
        <div className="dsh-qa-role-skills" data-testid="qa-admin-role-skills">
          <p>
            Навык сам объявляет, каким сабролям он доступен. Здесь настраиваются
            общие навыки и назначения, добавленные вручную.
          </p>
          <section data-testid="qa-admin-role-declared-skills">
            <h4>Объявлены навыками</h4>
            {declaredSkills.length === 0 ? (
              <p
                className="dsh-qa-admin__empty"
                data-testid="qa-admin-role-declared-empty"
              >
                Ни один навык не объявляет эту саброль.
              </p>
            ) : (
              <ul
                className="dsh-qa-skill-list"
                data-testid="qa-admin-role-declared-list"
              >
                {declaredSkills.map((skill) => (
                  <li
                    key={skill.name}
                    data-testid="qa-admin-role-declared-item"
                  >
                    <strong>{skill.name}</strong>
                    <span data-testid="qa-admin-role-declared-grants">
                      {skill.descriptor.requiredTools.length === 0
                        ? "Не выдаёт инструменты"
                        : `Выдаёт при активации: ${skill.descriptor.requiredTools.join(", ")}`}
                    </span>
                    <em data-testid="qa-admin-role-declared-mark">
                      Объявлено навыком
                    </em>
                  </li>
                ))}
              </ul>
            )}
            <p className="dsh-qa-role-skills__hint">
              Отозвать объявленный навык можно на странице «Навыки».
            </p>
          </section>
          <section data-testid="qa-admin-role-granted-skills">
            <h4>Общие и ролевые навыки</h4>
            <CapabilityPicker
              type="skill"
              testId="qa-admin-role-skills-picker"
              catalog={props.catalog}
              inherited={props.common.skills}
              system={props.system.skills}
              selected={draft.capabilities.skills}
              skillDetails={props.skills}
              onChange={setSkills}
            />
          </section>
        </div>
      ) : (
        <div className="dsh-qa-effective" data-testid="qa-admin-role-effective">
          <h3>
            Фактический доступ для {draft.name || draft.id || "новой роли"}
          </h3>
          <section data-testid="qa-admin-role-effective-always">
            <h4>{TOOL_BUCKET_LABELS.always}</h4>
            {effective.alwaysTools.length === 0 ? (
              <p
                className="dsh-qa-admin__empty"
                data-testid="qa-admin-role-effective-always-empty"
              >
                Нет инструментов.
              </p>
            ) : (
              <ul
                className="dsh-qa-effective__list"
                data-testid="qa-admin-role-effective-list"
              >
                {effective.alwaysTools.map((tool) => (
                  <li key={tool} data-testid="qa-admin-role-effective-item">
                    <code>{tool}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section data-testid="qa-admin-role-effective-grantable">
            <h4>{TOOL_BUCKET_LABELS.skillGrantable}</h4>
            {effective.grantable.length === 0 ? (
              <p
                className="dsh-qa-admin__empty"
                data-testid="qa-admin-role-effective-grantable-empty"
              >
                Роль не может выдавать инструменты.
              </p>
            ) : (
              <ul
                className="dsh-qa-effective__list"
                data-testid="qa-admin-role-effective-list"
              >
                {effective.grantable.map((tool) => (
                  <li key={tool} data-testid="qa-admin-role-effective-item">
                    <code>{tool}</code>
                    <span data-testid="qa-admin-role-effective-via">
                      {effective.via.get(tool) === undefined
                        ? "Сейчас не используется ни одним назначенным навыком"
                        : `Доступен через: ${effective.via.get(tool)?.join(", ")}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {effective.denied.length === 0 ? null : (
            <section data-testid="qa-admin-role-effective-denied">
              <h4>{TOOL_BUCKET_LABELS.deny}</h4>
              <ul
                className="dsh-qa-effective__list"
                data-testid="qa-admin-role-effective-list"
              >
                {effective.denied.map((tool) => (
                  <li key={tool} data-testid="qa-admin-role-effective-item">
                    <code>{tool}</code>
                    <span>Снят с этой саброли</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section data-testid="qa-admin-role-effective-skills">
            <h4>Навыки</h4>
            <ul
              className="dsh-qa-effective__list"
              data-testid="qa-admin-role-effective-list"
            >
              {[...unique([...effective.managed, ...effective.declared])].map(
                (skill) => (
                  <li key={skill} data-testid="qa-admin-role-effective-item">
                    <code>{skill}</code>
                    <span data-testid="qa-admin-role-effective-source">
                      {effective.declared.includes(skill)
                        ? "Назначен навыком"
                        : "Назначен администратором"}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </section>
        </div>
      )}
      <div
        className="dsh-qa-admin__savebar"
        data-testid="qa-admin-role-savebar"
      >
        <span>Изменения применяются к новым разговорам.</span>
        <button
          type="button"
          data-testid="qa-admin-role-cancel"
          onClick={props.onCancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className="dsh-qa-admin__primary"
          data-testid="qa-admin-role-save"
          disabled={
            saving || draft.id.trim() === "" || draft.name.trim() === ""
          }
          onClick={() => {
            setSaving(true);
            void props.onSave(draft).finally(() => setSaving(false));
          }}
        >
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
    </section>
  );
}
