import { useRef, useState } from "react";
import {
  DEFAULT_TOOL_LOOP_RULES,
  resolveToolLoopRules,
  TOOL_LOOP_LIMITS,
  toolLoopRuleIssue,
  type ToolLoopRule,
  type ToolLoopRuleInput,
  type ToolLoopRuleIssue,
  type ToolLoopThreshold,
} from "../../../shared/tool-loop-rules.js";
import { ResetButton, Section, SelectField } from "../fields.js";
import { resetAside, type ConfigProps } from "./common.js";

export const TOOL_LOOP_RULES_PATH = ["tools", "loopRules"] as const;
const PATHS = [TOOL_LOOP_RULES_PATH] as const;

const ACTIONS = [
  { value: "warn", label: "Предупредить ассистента" },
  { value: "block", label: "Заблокировать инструмент" },
  { value: "finish", label: "Завершить ход" },
] as const;

const ISSUES: Record<ToolLoopRuleIssue["code"], string> = {
  rules: `Можно задать до ${TOOL_LOOP_LIMITS.rules} правил.`,
  tool: "Укажите точное имя инструмента. Допустимы латинские буквы, цифры, подчёркивания и дефисы.",
  duplicateTool: "Для каждого инструмента нужно одно правило.",
  difference: "Укажите целый процент от 0 до 100.",
  thresholds: `Добавьте от 1 до ${TOOL_LOOP_LIMITS.thresholds} порогов.`,
  calls: `Укажите номер вызова от 2 до ${TOOL_LOOP_LIMITS.calls}. Блокировка и завершение доступны с третьего вызова.`,
  duplicateCalls: "У каждого порога должен быть свой номер вызова.",
  actions:
    "Предупреждения идут перед блокировками. Завершение можно задать один раз, на последнем пороге.",
  message: `Заполните сообщение для каждого порога. Максимум ${TOOL_LOOP_LIMITS.message} символов.`,
};

interface ThresholdDraft extends ToolLoopThreshold {
  readonly id: number;
}

interface RuleDraft extends ToolLoopRule {
  readonly id: number;
  readonly thresholds: readonly ThresholdDraft[];
  readonly openOnAdd?: true;
}

function ruleDraft(rule: ToolLoopRuleInput, id: number): RuleDraft {
  return {
    id,
    tool: rule.tool,
    maxDifferencePercent: rule.maxDifferencePercent ?? 0,
    thresholds: rule.thresholds.map((threshold, index) => ({
      ...threshold,
      id: index,
    })),
  };
}

function nextId(rows: readonly { id: number }[]): number {
  return Math.max(-1, ...rows.map((row) => row.id)) + 1;
}

function ThresholdEditor({
  threshold,
  disabled,
  onChange,
  onRemove,
}: {
  readonly threshold: ThresholdDraft;
  readonly disabled: boolean;
  readonly onChange: (threshold: ThresholdDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <fieldset className="qa-card-loop-threshold" disabled={disabled}>
      <legend>Порог</legend>
      <div className="qa-card-loop-fields">
        <label className="qa-card-field">
          <span>Номер вызова</span>
          <input
            className="qa-card-control"
            type="number"
            min={2}
            max={TOOL_LOOP_LIMITS.calls}
            value={Number.isNaN(threshold.calls) ? "" : threshold.calls}
            onChange={(event) =>
              onChange({
                ...threshold,
                calls: event.currentTarget.valueAsNumber,
              })
            }
          />
        </label>
        <SelectField
          label="Действие"
          value={threshold.action}
          disabled={disabled}
          options={ACTIONS}
          onChange={(action) =>
            onChange({
              ...threshold,
              action: action as ToolLoopThreshold["action"],
            })
          }
        />
      </div>
      <label className="qa-card-field">
        <span>Сообщение ассистенту</span>
        <textarea
          className="qa-card-control"
          rows={2}
          maxLength={TOOL_LOOP_LIMITS.message}
          value={threshold.message}
          onChange={(event) =>
            onChange({ ...threshold, message: event.currentTarget.value })
          }
        />
      </label>
      <ResetButton
        disabled={disabled}
        label="Удалить порог"
        onClick={onRemove}
      />
    </fieldset>
  );
}

function RuleEditor({
  rule,
  disabled,
  onChange,
  onRemove,
}: {
  readonly rule: RuleDraft;
  readonly disabled: boolean;
  readonly onChange: (rule: RuleDraft) => void;
  readonly onRemove: () => void;
}) {
  const addThreshold = useRef<HTMLButtonElement>(null);
  return (
    <details
      className="qa-card-advanced qa-card-loop-rule"
      open={rule.openOnAdd}
    >
      <summary>{rule.tool || "Новый инструмент"}</summary>
      <fieldset
        className="qa-card-advanced-content qa-card-loop-editor"
        disabled={disabled}
        aria-label={rule.tool || "Новый инструмент"}
      >
        <label className="qa-card-field">
          <span>Имя инструмента</span>
          <input
            className="qa-card-control"
            maxLength={TOOL_LOOP_LIMITS.toolName}
            value={rule.tool}
            onChange={(event) =>
              onChange({ ...rule, tool: event.currentTarget.value })
            }
          />
        </label>
        <label className="qa-card-field">
          <span>Допустимое отличие результатов, %</span>
          <input
            className="qa-card-control"
            type="number"
            min={0}
            max={100}
            value={
              Number.isNaN(rule.maxDifferencePercent)
                ? ""
                : rule.maxDifferencePercent
            }
            onChange={(event) =>
              onChange({
                ...rule,
                maxDifferencePercent: event.currentTarget.valueAsNumber,
              })
            }
          />
          <span className="qa-card-muted">
            0% означает точное совпадение. Для результатов длиннее{" "}
            {TOOL_LOOP_LIMITS.comparableCharacters} символов сравнение всегда
            точное.
          </span>
        </label>
        {rule.thresholds.map((threshold) => (
          <ThresholdEditor
            key={threshold.id}
            threshold={threshold}
            disabled={disabled}
            onChange={(next) =>
              onChange({
                ...rule,
                thresholds: rule.thresholds.map((item) =>
                  item.id === next.id ? next : item,
                ),
              })
            }
            onRemove={() => {
              addThreshold.current?.focus();
              onChange({
                ...rule,
                thresholds: rule.thresholds.filter(
                  (item) => item.id !== threshold.id,
                ),
              });
            }}
          />
        ))}
        <div className="qa-card-loop-actions">
          <button
            ref={addThreshold}
            type="button"
            className="qa-card-btn"
            disabled={
              disabled || rule.thresholds.length >= TOOL_LOOP_LIMITS.thresholds
            }
            onClick={() =>
              onChange({
                ...rule,
                thresholds: [
                  ...rule.thresholds,
                  {
                    id: nextId(rule.thresholds),
                    calls: NaN,
                    action: "warn",
                    message: "",
                  },
                ],
              })
            }
          >
            Добавить порог
          </button>
          <ResetButton
            disabled={disabled}
            label="Удалить правило"
            onClick={onRemove}
          />
        </div>
      </fieldset>
    </details>
  );
}

export function ToolLoopSection(
  props: ConfigProps & {
    readonly onSave: (rules: readonly ToolLoopRule[]) => Promise<boolean>;
  },
) {
  const saved =
    props.config?.tools?.loopRules ??
    props.effective?.tools.loopRules ??
    DEFAULT_TOOL_LOOP_RULES;
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<{
    readonly base: string;
    readonly rows: readonly RuleDraft[];
  }>();
  const [issue, setIssue] = useState<ToolLoopRuleIssue>();
  const [saving, setSaving] = useState(false);
  const addRule = useRef<HTMLButtonElement>(null);
  const rows = draft?.rows ?? saved.map(ruleDraft);
  const stale = draft !== undefined && draft.base !== savedKey;
  const disabled = !props.writable || saving;

  function edit(next: readonly RuleDraft[]) {
    setDraft({ base: draft?.base ?? savedKey, rows: next });
    setIssue(undefined);
  }

  async function save() {
    const problem = toolLoopRuleIssue(rows);
    if (problem !== undefined) {
      setIssue(problem);
      return;
    }
    setSaving(true);
    try {
      if (await props.onSave(resolveToolLoopRules(rows))) setDraft(undefined);
    } finally {
      setSaving(false);
    }
  }

  const affected =
    issue?.ruleIndex === undefined ? undefined : rows[issue.ruleIndex];
  return (
    <Section
      title="Повторные вызовы инструментов"
      modified={props.overridden(TOOL_LOOP_RULES_PATH)}
      testId="qa-settings-tool-loop"
      aside={resetAside(
        { ...props, writable: !disabled && draft === undefined },
        PATHS,
        "qa-settings-tool-loop-reset",
      )}
    >
      <p className="qa-card-muted">
        QA сравнивает результаты каждого инструмента с первым результатом серии
        в пределах хода. Предупреждение приходит после указанного вызова.
        Блокировка и завершение срабатывают до вызова. Сохранённые правила
        вступают в силу со следующего хода.
      </p>
      {rows.length === 0 && (
        <p className="qa-card-muted">Правил для отдельных инструментов нет.</p>
      )}
      {rows.map((rule) => (
        <RuleEditor
          key={rule.id}
          rule={rule}
          disabled={disabled}
          onChange={(next) =>
            edit(rows.map((row) => (row.id === next.id ? next : row)))
          }
          onRemove={() => {
            addRule.current?.focus();
            edit(rows.filter((row) => row.id !== rule.id));
          }}
        />
      ))}
      {issue !== undefined && (
        <p className="qa-card-error" role="alert">
          {affected?.tool ? `${affected.tool}. ` : ""}
          {ISSUES[issue.code]}
        </p>
      )}
      {stale && !saving && (
        <p className="qa-card-error" role="alert">
          Список на хосте изменился. Отмените черновик, чтобы открыть
          сохранённые правила.
        </p>
      )}
      <div className="qa-card-loop-actions">
        <button
          ref={addRule}
          type="button"
          className="qa-card-btn"
          disabled={disabled || rows.length >= TOOL_LOOP_LIMITS.rules}
          onClick={() =>
            edit([
              ...rows,
              {
                ...ruleDraft(
                  {
                    tool: "",
                    thresholds: [{ calls: 2, action: "warn", message: "" }],
                  },
                  nextId(rows),
                ),
                openOnAdd: true,
              },
            ])
          }
        >
          Добавить правило
        </button>
        {draft !== undefined && (
          <>
            <button
              type="button"
              className="qa-card-btn"
              disabled={disabled || stale}
              onClick={() => {
                void save();
              }}
            >
              {saving ? "Сохраняю правила…" : "Сохранить правила"}
            </button>
            <ResetButton
              disabled={saving}
              label="Отменить изменения"
              onClick={() => {
                setDraft(undefined);
                setIssue(undefined);
              }}
            />
          </>
        )}
      </div>
    </Section>
  );
}
