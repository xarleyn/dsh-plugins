import { useEffect, useMemo, useRef, useState } from "react";
import { QaModal } from "../components/QaModal.js";
import type { QaSkillToolDescriptor } from "../../types.js";
import { QaSettingsButton, QaSettingsNotice } from "./fields.js";

export interface QaSkillToolPickerProps {
  readonly open: boolean;
  readonly tools: readonly QaSkillToolDescriptor[];
  readonly toolsError: string | null;
  readonly selected: readonly string[];
  readonly onApply: (tools: readonly string[]) => void;
  readonly onClose: () => void;
}

/**
 * Multi-select over the deployment's tool catalog. Availability is the QA
 * session's own scope, and the picker says so: a tool the session cannot reach
 * is still offered — an imported skill has to stay repairable — but it is
 * grouped and labelled as unavailable, and choosing it grants nothing.
 */
export function QaSkillToolPicker(props: QaSkillToolPickerProps) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<readonly string[]>(props.selected);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!props.open) return;
    setDraft(props.selected);
    setQuery("");
  }, [props.open, props.selected]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return props.tools;
    return props.tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(needle) ||
        tool.description.toLowerCase().includes(needle),
    );
  }, [props.tools, query]);
  const available = visible.filter((tool) => tool.available);
  const unavailable = visible.filter((tool) => !tool.available);
  const toggle = (name: string, checked: boolean) => {
    setDraft((current) =>
      checked
        ? current.includes(name)
          ? current
          : [...current, name]
        : current.filter((tool) => tool !== name),
    );
  };
  const move = (from: number, delta: number) => {
    const inputs = [
      ...(list.current?.querySelectorAll<HTMLInputElement>(
        "input[type='checkbox']",
      ) ?? []),
    ];
    const next = inputs[from + delta];
    next?.focus();
  };
  // Rows are rendered group by group, so the arrow keys have to walk the
  // document order: the offset carries the previous group's size.
  const groupRows = (tools: readonly QaSkillToolDescriptor[], offset: number) =>
    tools.map((tool, index) => (
      <li key={tool.name} className="dsh-qa-toolpicker__row">
        <label className="dsh-qa-toolpicker__label">
          <input
            type="checkbox"
            checked={draft.includes(tool.name)}
            onChange={(event) => toggle(tool.name, event.currentTarget.checked)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                move(offset + index, 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                move(offset + index, -1);
              }
            }}
          />
          <span className="dsh-qa-toolpicker__name">{tool.name}</span>
          {tool.description === "" ? null : (
            <span className="dsh-qa-toolpicker__description">
              {tool.description}
            </span>
          )}
        </label>
      </li>
    ));
  return (
    <QaModal
      open={props.open}
      title="Добавить инструменты"
      closeLabel="Закрыть выбор инструментов"
      wide
      onClose={props.onClose}
      footer={
        <>
          <span className="dsh-qa-toolpicker__selected">
            Выбрано: {draft.length}
          </span>
          <QaSettingsButton label="Отмена" onClick={props.onClose} />
          <QaSettingsButton
            tone="primary"
            label="Применить"
            onClick={() => props.onApply(draft)}
          />
        </>
      }
    >
      {props.toolsError === null ? null : (
        <QaSettingsNotice tone="error">{props.toolsError}</QaSettingsNotice>
      )}
      <input
        className="dsh-qa-settings__search"
        type="search"
        value={query}
        placeholder="Поиск инструментов…"
        aria-label="Поиск инструментов"
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <ul ref={list} className="dsh-qa-toolpicker__list">
        {available.length === 0 ? null : (
          <>
            <li className="dsh-qa-toolpicker__group">Доступные сейчас</li>
            {groupRows(available, 0)}
          </>
        )}
        {unavailable.length === 0 ? null : (
          <>
            <li className="dsh-qa-toolpicker__group">
              Недоступные в этой конфигурации
            </li>
            {groupRows(unavailable, available.length)}
          </>
        )}
      </ul>
      {visible.length === 0 ? (
        <p className="dsh-qa-settings__field-hint">
          Инструментов по запросу не нашлось.
        </p>
      ) : null}
    </QaModal>
  );
}
