/**
 * The rule table (SPEC §6.1): one row per rule, with the four row actions and
 * the editor/tester panels opened inline. Rows never render a credential
 * value — only the auth kind and the reference name.
 * @module client/sections/rules
 */

import { useState } from "react";
import type {
  AuthenticatedFetchRule,
  WebFetchAuthConfig,
} from "../../types.js";
import { authSummary, originSummary } from "../format.js";
import {
  ICON_DELETE,
  ICON_EDIT,
  ICON_POWER,
  ICON_TEST,
  IconButton,
  Pill,
  type CardFace,
} from "./common.js";
import { adapterSummary } from "./rule-draft.js";
import { RuleEditor } from "./rule-editor.js";
import { RuleTester } from "./rule-tester.js";

/** The rule table (SPEC §6.1) with inline editor and tester. */
export function RulesSection({
  config,
  writable,
  setRules,
  face,
}: {
  config: WebFetchAuthConfig | undefined;
  writable: boolean;
  setRules: (rules: AuthenticatedFetchRule[]) => void;
  face: CardFace;
}): JSX.Element {
  const rules = config?.rules ?? [];
  const [editingId, setEditingId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [testingId, setTestingId] = useState<string | undefined>();

  const saveRule = (rule: AuthenticatedFetchRule): void => {
    const index = rules.findIndex((candidate) => candidate.id === rule.id);
    const next =
      index >= 0
        ? rules.map((candidate) =>
            candidate.id === rule.id ? rule : candidate,
          )
        : [...rules, rule];
    setRules(next);
    setEditingId(undefined);
    setCreating(false);
  };
  const deleteRule = (id: string): void => {
    setRules(rules.filter((rule) => rule.id !== id));
  };
  const toggleRule = (id: string, enabled: boolean): void => {
    setRules(
      rules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)),
    );
  };

  return (
    <section className="wfa-section">
      <div className="wfa-section-title">
        <h3>Rules</h3>
        <button
          className="wfa-btn"
          type="button"
          disabled={!writable}
          onClick={() => {
            setCreating(true);
            setEditingId(undefined);
          }}
        >
          Add rule
        </button>
      </div>
      {rules.length === 0 && creating === false && (
        <div className="wfa-empty">
          No rules yet. Every URL is rejected until a rule matches (strict
          mode).
        </div>
      )}
      <div className="wfa-rules">
        {rules.map((rule) => (
          <div key={rule.id}>
            <div className="wfa-rule">
              <span className="wfa-rule-main">
                <span className="wfa-rule-name">{rule.name}</span>
                <span className="wfa-rule-origin">{originSummary(rule)}</span>
              </span>
              <span className="wfa-actions" style={{ gap: 5 }}>
                <Pill tone={rule.enabled ? "ok" : "warn"}>
                  {rule.enabled ? "enabled" : "disabled"}
                </Pill>
                <Pill tone="warn">{authSummary(rule.auth)}</Pill>
                {rule.adapter !== undefined && rule.adapter.type !== "none" && (
                  <Pill tone="ok">{adapterSummary(rule.adapter)}</Pill>
                )}
              </span>
              <span className="wfa-actions">
                <IconButton
                  label={rule.enabled ? "Disable" : "Enable"}
                  disabled={!writable}
                  onClick={() => {
                    toggleRule(rule.id, !rule.enabled);
                  }}
                >
                  {ICON_POWER}
                </IconButton>
                <IconButton
                  label="Test"
                  onClick={() => {
                    setTestingId(testingId === rule.id ? undefined : rule.id);
                    setEditingId(undefined);
                    setCreating(false);
                  }}
                >
                  {ICON_TEST}
                </IconButton>
                <IconButton
                  label="Edit"
                  disabled={!writable}
                  onClick={() => {
                    setEditingId(editingId === rule.id ? undefined : rule.id);
                    setCreating(false);
                    setTestingId(undefined);
                  }}
                >
                  {ICON_EDIT}
                </IconButton>
                <IconButton
                  label="Delete"
                  danger
                  disabled={!writable}
                  onClick={() => {
                    deleteRule(rule.id);
                  }}
                >
                  {ICON_DELETE}
                </IconButton>
              </span>
            </div>
            {testingId === rule.id && (
              <RuleTester
                ruleId={rule.id}
                defaultUrl={rule.testUrl ?? ""}
                testRule={face.testRule}
              />
            )}
            {editingId === rule.id && (
              <div style={{ paddingTop: 6 }}>
                <RuleEditor
                  initial={rule}
                  credentials={face.credentials}
                  onSave={saveRule}
                  onCancel={() => {
                    setEditingId(undefined);
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      {creating && (
        <RuleEditor
          initial={undefined}
          credentials={face.credentials}
          onSave={saveRule}
          onCancel={() => {
            setCreating(false);
          }}
        />
      )}
    </section>
  );
}
