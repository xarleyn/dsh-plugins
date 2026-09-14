import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  QA_SKILL_DESCRIPTION_MAX,
  QA_SKILL_WHEN_TO_USE_MAX,
} from "../../personal-skills/skill-file.js";
import { QaModal } from "../components/QaModal.js";
import type {
  QaSkillDiagnostic,
  QaSkillDocument,
  QaSkillDraftInput,
  QaSkillToolDescriptor,
} from "../../types.js";
import {
  SKILLS_BEHAVIOUR_HINT,
  SKILLS_DESCRIPTION_HINT,
  SKILLS_NAME_HINT,
  SKILLS_TOOLS_HINT,
  diagnosticMessage,
} from "./copy.js";
import {
  draftFromDocument,
  draftHasContent,
  draftIsDirty,
  draftIsSavable,
  draftPreview,
  draftDiagnostics,
  draftInput,
  emptyDraft,
  mergeDiagnostics,
  withToolRemoved,
  type QaSkillDraft,
} from "./draft.js";
import {
  QaSettingsButton,
  QaSettingsField,
  QaSettingsNotice,
  QaSettingsSection,
  QaSettingsToggle,
} from "./fields.js";
import { QaSkillToolPicker } from "./SkillToolPicker.js";

const FORM_ID = "dsh-qa-settings-skill-form";

export interface QaSkillEditorProps {
  /** `create` starts from an empty draft; `edit` from the loaded document. */
  readonly mode: "create" | "edit";
  /** Absent while a fresh skill is being created. */
  readonly document: QaSkillDocument | null;
  readonly tools: readonly QaSkillToolDescriptor[];
  readonly toolsError: string | null;
  readonly saving: boolean;
  readonly error: string | null;
  /** True once a save was refused because the file changed elsewhere. */
  readonly conflict: boolean;
  readonly onBack: () => void;
  readonly onSave: (input: QaSkillDraftInput) => void;
  readonly onDelete: () => void;
  /** Re-read the stored skill after a conflict; absent on create. */
  readonly onReload: () => void;
}

/**
 * One skill's editor. It never wraps itself in a nested modal — the settings
 * dialog's own content area is the page — and the preview is produced by the
 * same serializer and validator the Host uses, so what the panel shows is
 * exactly what a Save writes.
 */
export function QaSkillEditor(props: QaSkillEditorProps) {
  const { document } = props;
  const [draft, setDraft] = useState<QaSkillDraft>(() =>
    document === null ? emptyDraft() : draftFromDocument(document),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Re-seed whenever the stored skill changes: a reload after a conflict, or a
  // save whose canonical form differs from the draft.
  useEffect(() => {
    setDraft(document === null ? emptyDraft() : draftFromDocument(document));
    setConfirmDiscard(false);
  }, [document]);
  const extraFrontmatter = document?.extraFrontmatter ?? {};
  const storedDiagnostics = useMemo(
    () => document?.diagnostics ?? [],
    [document],
  );
  const availableTools = useMemo(
    () => props.tools.filter((tool) => tool.available).map((tool) => tool.name),
    [props.tools],
  );
  const availableSet = useMemo(() => new Set(availableTools), [availableTools]);
  // An empty inventory means the catalog could not be read, not that the
  // session can reach nothing: only a loaded catalog may call a tool missing.
  const catalogKnown = props.tools.length > 0;
  const diagnostics = useMemo(
    () => draftDiagnostics(draft, extraFrontmatter, { availableTools }),
    [draft, extraFrontmatter, availableTools],
  );
  const blocking = diagnostics.filter((entry) => entry.severity === "error");
  const changed =
    document === null ? draftHasContent(draft) : draftIsDirty(draft, document);
  const preview = useMemo(
    () => draftPreview(draft, extraFrontmatter),
    [draft, extraFrontmatter],
  );
  const update = (patch: Partial<QaSkillDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const back = () => {
    if (changed && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    props.onBack();
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (props.saving || blocking.length > 0 || !draftIsSavable(draft)) return;
    props.onSave(draftInput(draft, document?.revision ?? null));
  };
  const removeTool = (name: string) =>
    update({ allowedTools: withToolRemoved(draft.allowedTools, name) });
  return (
    <form id={FORM_ID} className="dsh-qa-settings__page" onSubmit={submit}>
      <div className="dsh-qa-settings__page-head">
        <button type="button" className="dsh-qa-settings__back" onClick={back}>
          ← Навыки
        </button>
        <div className="dsh-qa-settings__head-actions">
          {props.mode === "edit" ? (
            <QaSettingsButton
              label="Удалить"
              tone="danger"
              onClick={() => setConfirmDelete(true)}
            />
          ) : null}
          <QaSettingsButton
            type="submit"
            tone="primary"
            label={props.saving ? "Сохранение…" : "Сохранить"}
            disabled={
              props.saving || blocking.length > 0 || !draftIsSavable(draft)
            }
          />
        </div>
      </div>
      {confirmDiscard ? (
        <QaSettingsNotice tone="warn">
          Есть несохранённые изменения.{" "}
          <button
            type="button"
            className="dsh-qa-settings__link"
            onClick={props.onBack}
          >
            Выйти без сохранения
          </button>{" "}
          <button
            type="button"
            className="dsh-qa-settings__link"
            onClick={() => setConfirmDiscard(false)}
          >
            Остаться
          </button>
        </QaSettingsNotice>
      ) : null}
      {props.error === null ? null : (
        <QaSettingsNotice tone="error">
          {props.error}
          {props.conflict ? (
            <>
              {" "}
              <button
                type="button"
                className="dsh-qa-settings__link"
                onClick={props.onReload}
              >
                Перезагрузить текущую версию
              </button>
            </>
          ) : null}
        </QaSettingsNotice>
      )}
      <QaSettingsField label="Название" hint={SKILLS_NAME_HINT}>
        <input
          value={draft.name}
          placeholder="jira-investigation"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => update({ name: event.currentTarget.value })}
        />
      </QaSettingsField>
      <QaSettingsField label="Описание" hint={SKILLS_DESCRIPTION_HINT}>
        <textarea
          rows={3}
          value={draft.description}
          maxLength={QA_SKILL_DESCRIPTION_MAX}
          onChange={(event) =>
            update({ description: event.currentTarget.value })
          }
        />
      </QaSettingsField>
      <QaSettingsField
        label="Когда использовать"
        hint="Необязательно: подсказка ассистенту, в каких ситуациях навык уместен."
      >
        <textarea
          rows={2}
          value={draft.whenToUse}
          maxLength={QA_SKILL_WHEN_TO_USE_MAX}
          onChange={(event) => update({ whenToUse: event.currentTarget.value })}
        />
      </QaSettingsField>
      <QaSettingsSection title="Поведение">
        <QaSettingsToggle
          label="Агент может использовать навык автоматически"
          hint={SKILLS_BEHAVIOUR_HINT}
          checked={draft.modelInvocable}
          onChange={(checked) => update({ modelInvocable: checked })}
        />
        <QaSettingsToggle
          label={`Доступен как /${draft.name.trim() === "" ? "имя" : draft.name.trim()}`}
          hint="Если выключено, навык видит только ассистент."
          checked={draft.userInvocable}
          onChange={(checked) => update({ userInvocable: checked })}
        />
      </QaSettingsSection>
      <QaSettingsSection
        title="Инструменты"
        aside={
          <span className="dsh-qa-settings__section-aside">
            {draft.allowedTools.length} выбрано
          </span>
        }
      >
        {draft.allowedTools.length === 0 ? null : (
          <ul className="dsh-qa-settings__chips">
            {draft.allowedTools.map((name) => {
              const unavailable = catalogKnown && !availableSet.has(name);
              return (
                <li
                  key={name}
                  className={
                    unavailable
                      ? "dsh-qa-settings__chip dsh-qa-settings__chip--unavailable"
                      : "dsh-qa-settings__chip"
                  }
                >
                  <span>{name}</span>
                  <button
                    type="button"
                    className="dsh-qa-settings__chip-remove"
                    aria-label={`Убрать инструмент ${name}`}
                    title={
                      unavailable
                        ? "Сейчас недоступен в этой конфигурации; останется в файле до удаления"
                        : "Убрать инструмент"
                    }
                    onClick={() => removeTool(name)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <QaSettingsButton
          label="Добавить инструменты"
          onClick={() => setPickerOpen(true)}
        />
        <p className="dsh-qa-settings__field-hint">{SKILLS_TOOLS_HINT}</p>
      </QaSettingsSection>
      <QaSettingsField
        label="Инструкции"
        hint="Markdown. Это тело навыка — ассистент читает его, когда применяет навык."
      >
        <textarea
          className="dsh-qa-settings__code"
          rows={12}
          value={draft.body}
          spellCheck={false}
          placeholder={"# Заголовок\n\n1. Первый шаг\n2. Второй шаг"}
          onChange={(event) => update({ body: event.currentTarget.value })}
        />
      </QaSettingsField>
      <SkillDiagnostics
        diagnostics={mergeDiagnostics(storedDiagnostics, diagnostics)}
      />
      <QaSettingsSection title="Дополнительно">
        <QaSettingsButton
          label={advancedOpen ? "Скрыть" : "Показать"}
          onClick={() => setAdvancedOpen((current) => !current)}
        />
        {advancedOpen ? (
          <div className="dsh-qa-settings__advanced">
            {document === null ? null : (
              <p className="dsh-qa-settings__field-hint">
                Файл навыка: <code>{document.sourcePath}</code>
              </p>
            )}
            {Object.keys(extraFrontmatter).length === 0 ? null : (
              <div>
                <p className="dsh-qa-settings__field-hint">
                  Сохраняемые поля frontmatter:
                </p>
                <pre className="dsh-qa-settings__preview">
                  {JSON.stringify(extraFrontmatter, null, 2)}
                </pre>
              </div>
            )}
            <div>
              <p className="dsh-qa-settings__field-hint">
                Предпросмотр SKILL.md:
              </p>
              <pre className="dsh-qa-settings__preview">{preview}</pre>
            </div>
          </div>
        ) : null}
      </QaSettingsSection>
      <QaSkillToolPicker
        open={pickerOpen}
        tools={props.tools}
        toolsError={props.toolsError}
        selected={draft.allowedTools}
        onClose={() => setPickerOpen(false)}
        onApply={(tools) => {
          update({ allowedTools: tools });
          setPickerOpen(false);
        }}
      />
      <QaModal
        open={confirmDelete}
        title="Удалить навык"
        closeLabel="Закрыть подтверждение удаления"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <QaSettingsButton
              label="Отмена"
              onClick={() => setConfirmDelete(false)}
            />
            <QaSettingsButton
              tone="danger"
              label="Удалить навык"
              onClick={() => {
                setConfirmDelete(false);
                props.onDelete();
              }}
            />
          </>
        }
      >
        <p className="dsh-qa-settings__lead">
          Удалить навык «{draft.name.trim() || "без названия"}»? Его можно будет
          восстановить вручную из корзины.
        </p>
      </QaModal>
    </form>
  );
}

function SkillDiagnostics(props: {
  readonly diagnostics: readonly QaSkillDiagnostic[];
}) {
  const errors = props.diagnostics.filter(
    (entry) => entry.severity === "error",
  );
  const warnings = props.diagnostics.filter(
    (entry) => entry.severity === "warning",
  );
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <ul className="dsh-qa-settings__diagnostics">
      {[...errors, ...warnings].map((entry, index) => (
        <li
          key={`${entry.code}:${entry.detail ?? ""}:${String(index)}`}
          className={
            entry.severity === "error"
              ? "dsh-qa-settings__diagnostic dsh-qa-settings__diagnostic--error"
              : "dsh-qa-settings__diagnostic"
          }
        >
          {diagnosticMessage(entry)}
        </li>
      ))}
    </ul>
  );
}
