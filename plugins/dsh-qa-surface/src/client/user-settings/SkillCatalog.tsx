import { useMemo, useState } from "react";
import type { QaSkillSummary } from "../../types.js";
import { QaSettingsButton, QaSettingsNotice } from "./fields.js";
import { SKILLS_EMPTY_COPY, diagnosticMessage } from "./copy.js";
import { skillMatchesQuery, skillMetaLine, skillToolWarning } from "./draft.js";

export interface QaSkillCatalogProps {
  readonly skills: readonly QaSkillSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onOpen: (name: string) => void;
  readonly onCreate: () => void;
  readonly onReload: () => void;
}

/**
 * The skills list: what exists, how it is invoked, and what needs attention.
 * Search is client-side over the fields the spec names (name, description,
 * whenToUse) — the catalog of one account is small by construction.
 */
export function QaSkillCatalog(props: QaSkillCatalogProps) {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => props.skills.filter((skill) => skillMatchesQuery(skill, query)),
    [props.skills, query],
  );
  return (
    <div className="dsh-qa-settings__page">
      <div className="dsh-qa-settings__page-head">
        <div className="dsh-qa-settings__head-text">
          <h3 className="dsh-qa-settings__page-title">Навыки</h3>
          <p className="dsh-qa-settings__field-hint">
            Инструкции, которые ассистент применяет к повторяющимся задачам.
          </p>
        </div>
        <QaSettingsButton
          tone="primary"
          label="Создать навык"
          onClick={props.onCreate}
        />
      </div>
      {props.error === null ? null : (
        <QaSettingsNotice tone="error">
          {props.error}{" "}
          <button
            type="button"
            className="dsh-qa-settings__link"
            onClick={props.onReload}
          >
            Обновить
          </button>
        </QaSettingsNotice>
      )}
      {props.loading && props.skills.length === 0 ? (
        <p className="dsh-qa-settings__field-hint">Загрузка…</p>
      ) : null}
      {!props.loading && props.skills.length === 0 ? (
        <div className="dsh-qa-settings__empty">
          <p className="dsh-qa-settings__empty-title">
            {SKILLS_EMPTY_COPY.title}
          </p>
          <p className="dsh-qa-settings__field-hint">
            {SKILLS_EMPTY_COPY.body}
          </p>
          <QaSettingsButton
            tone="primary"
            label={SKILLS_EMPTY_COPY.action}
            onClick={props.onCreate}
          />
        </div>
      ) : null}
      {props.skills.length === 0 ? null : (
        <>
          <input
            className="dsh-qa-settings__search"
            type="search"
            value={query}
            placeholder="Поиск навыков…"
            aria-label="Поиск навыков"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <ul className="dsh-qa-settings__rows">
            {visible.map((skill) => (
              <li key={skill.name} className="dsh-qa-settings__row">
                <button
                  type="button"
                  className="dsh-qa-settings__row-button"
                  onClick={() => props.onOpen(skill.name)}
                >
                  <span className="dsh-qa-settings__row-title">
                    {skill.name}
                  </span>
                  <span className="dsh-qa-settings__row-description">
                    {skill.description === ""
                      ? "Без описания"
                      : skill.description}
                  </span>
                  <span className="dsh-qa-settings__row-meta">
                    {skillMetaLine(skill)}
                  </span>
                  {skillToolWarning(skill) === null ? null : (
                    <span className="dsh-qa-settings__row-warning">
                      {skillToolWarning(skill)}
                    </span>
                  )}
                  {skill.valid ? null : (
                    <span className="dsh-qa-settings__row-error">
                      {diagnosticMessage(
                        skill.diagnostics.find(
                          (entry) => entry.severity === "error",
                        ) ?? {
                          code: "skill-file-missing",
                          severity: "error",
                          field: null,
                          detail: null,
                        },
                      )}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {visible.length === 0 ? (
            <p className="dsh-qa-settings__field-hint">
              Ничего не найдено. Измените запрос.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
