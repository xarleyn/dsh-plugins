import { useState } from "react";
import {
  CROSS_DOMAIN_MODES,
  EXPERT_MODES,
  type CatalogInfo,
  type DomainDefinition,
  type CrossDomainMode,
  type ExpertMode,
  type DomainExpertFinding,
  type MemoryInspectResult,
  type ResolvedExpertProfile,
  type ValidationIssueView,
} from "../types.js";
import { ScopeInspector } from "./ScopeInspector.js";
import {
  ListEditor,
  Section,
  Select,
  StatusLine,
  TextArea,
  TextInput,
  Toggle,
} from "./components.js";

const TABS = [
  "General",
  "Persona",
  "Resources",
  "Memory",
  "Tools",
  "Delegation",
  "Model",
  "Test",
] as const;

type TabId = (typeof TABS)[number];

export interface MemoryView {
  readonly result: MemoryInspectResult | null;
  readonly error: string;
}

export interface TestView {
  readonly running: boolean;
  readonly summary: string;
  readonly status: string;
  readonly findings: readonly DomainExpertFinding[];
  readonly error: string;
}

export interface EditorProps {
  readonly draft: DomainDefinition;
  readonly isNew: boolean;
  readonly busy: boolean;
  readonly status: { readonly tone: "info" | "error"; readonly text: string };
  readonly issues: readonly ValidationIssueView[];
  readonly catalog: CatalogInfo;
  readonly profile: ResolvedExpertProfile | null;
  readonly profileError: string;
  readonly memory: MemoryView;
  readonly test: TestView;
  readonly onChange: (next: DomainDefinition) => void;
  readonly onSave: () => void;
  readonly onDelete: () => void;
  readonly onCancel: () => void;
  readonly onInspectMemory: (namespace: string) => void;
  readonly onClearMemory: () => void;
  readonly onRunTest: (task: string) => void;
}

export function DomainEditor(props: EditorProps) {
  const [tab, setTab] = useState<TabId>("General");
  const { draft, onChange, issues } = props;
  const fieldIssue = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field && issue.severity === "error")
      ?.message;

  return (
    <div className="dx-panel">
      <div className="dx-section">
        <h3 className="dx-section-title">
          {props.isNew ? "New domain" : `Edit ${draft.name || draft.id}`}
        </h3>
        <p className="dx-section-note">
          Id <span className="dx-mono">{draft.id}</span>
          {props.isNew ? " (fixed once created)" : ""}
        </p>
      </div>

      <div className="dx-tabs" role="tablist">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className="dx-tab"
            onClick={() => {
              setTab(name);
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {issues.length > 0 ? (
        <ul className="dx-issues">
          {issues.map((issue, index) => (
            <li
              className={
                issue.severity === "error"
                  ? "dx-issue dx-issue--error"
                  : "dx-issue dx-issue--warning"
              }
              key={`${issue.field}-${String(index)}`}
            >
              <strong>{issue.field}</strong> {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      {tab === "General" ? (
        <Section
          title="Identity"
          note="Id and colour are presentation and identity only; the core never interprets them."
        >
          <TextInput
            label="Id"
            value={draft.id}
            invalid={fieldIssue("id") !== undefined}
            hint={
              fieldIssue("id") ??
              "Lowercase letters, digits and dashes. Used by domain_expert."
            }
            onChange={(id) => {
              onChange({ ...draft, id });
            }}
          />
          <TextInput
            label="Name"
            value={draft.name}
            invalid={fieldIssue("name") !== undefined}
            hint={fieldIssue("name")}
            onChange={(name) => {
              onChange({ ...draft, name });
            }}
          />
          <TextInput
            label="Description"
            value={draft.description}
            hint="One line, shown in the domain list and to the model."
            onChange={(description) => {
              onChange({ ...draft, description });
            }}
          />
          <div className="dx-row">
            <TextInput
              label="Icon"
              value={draft.icon}
              hint="Optional label or emoji."
              onChange={(icon) => {
                onChange({ ...draft, icon });
              }}
            />
            <TextInput
              label="Colour"
              value={draft.color}
              hint="Optional CSS colour."
              onChange={(color) => {
                onChange({ ...draft, color });
              }}
            />
          </div>
          <Toggle
            checked={draft.enabled}
            label="Enabled (a disabled domain is refused by domain_expert and hidden from the list)"
            onChange={(enabled) => {
              onChange({ ...draft, enabled });
            }}
          />
        </Section>
      ) : null}

      {tab === "Persona" ? (
        <Section
          title="Persona"
          note="The base policy is fixed and always present. Your instructions are appended; they never replace it."
        >
          <TextArea
            label="Base policy (read-only)"
            value={props.profile?.basePolicy ?? "Resolving…"}
            onChange={() => undefined}
            rows={10}
          />
          <TextArea
            label="Custom instructions"
            value={draft.persona.instructions}
            placeholder="What this domain cares about, which conventions it follows, what it must not do."
            onChange={(instructions) => {
              onChange({ ...draft, persona: { instructions } });
            }}
          />
          <TextArea
            label="Composed persona (read-only preview)"
            value={props.profile?.persona ?? "Resolving…"}
            onChange={() => undefined}
            rows={16}
          />
        </Section>
      ) : null}

      {tab === "Resources" ? (
        <Section
          title="Filesystem and knowledge scope"
          note="Paths are workspace-relative globs. A path matching the denied list is refused even when it also matches a primary one."
        >
          <ListEditor
            label="Primary paths"
            hint="Owned by this domain."
            placeholder="services/payments/**"
            values={draft.scope.filesystem.primary}
            onChange={(primary) => {
              onChange({
                ...draft,
                scope: {
                  ...draft.scope,
                  filesystem: { ...draft.scope.filesystem, primary },
                },
              });
            }}
          />
          <ListEditor
            label="Shared read-only paths"
            hint="Owned by another domain; readable, not writable."
            placeholder="packages/common/**"
            values={draft.scope.filesystem.sharedReadOnly}
            onChange={(sharedReadOnly) => {
              onChange({
                ...draft,
                scope: {
                  ...draft.scope,
                  filesystem: { ...draft.scope.filesystem, sharedReadOnly },
                },
              });
            }}
          />
          <ListEditor
            label="Denied paths"
            hint="Explicitly outside this domain."
            placeholder="services/inventory/**"
            values={draft.scope.filesystem.denied}
            onChange={(denied) => {
              onChange({
                ...draft,
                scope: {
                  ...draft.scope,
                  filesystem: { ...draft.scope.filesystem, denied },
                },
              });
            }}
          />
          <ListEditor
            label="Knowledge sources to include"
            placeholder="docs/payments/**"
            values={draft.scope.documentation.include}
            onChange={(include) => {
              onChange({
                ...draft,
                scope: {
                  ...draft.scope,
                  documentation: { ...draft.scope.documentation, include },
                },
              });
            }}
          />
          <ListEditor
            label="Knowledge sources to exclude"
            values={draft.scope.documentation.exclude}
            onChange={(exclude) => {
              onChange({
                ...draft,
                scope: {
                  ...draft.scope,
                  documentation: { ...draft.scope.documentation, exclude },
                },
              });
            }}
          />
          <p className="dx-section-note">
            Registered scope providers:{" "}
            {props.catalog.scopeProviders
              .map((provider) => provider.id)
              .join(", ") || "none"}
          </p>
        </Section>
      ) : null}

      {tab === "Memory" ? (
        <Section
          title="Memory"
          note="The private namespace accepts writes. Shared namespaces are read-only, and a foreign namespace is refused by code, not by instruction."
        >
          <TextInput
            label="Private namespace"
            value={draft.memory.namespace}
            invalid={fieldIssue("memory.namespace") !== undefined}
            hint={
              fieldIssue("memory.namespace") ??
              "Lowercase segments joined by '/'."
            }
            onChange={(namespace) => {
              onChange({ ...draft, memory: { ...draft.memory, namespace } });
            }}
          />
          <ListEditor
            label="Shared read-only namespaces"
            placeholder="shared/product"
            values={draft.memory.sharedReadOnly}
            onChange={(sharedReadOnly) => {
              onChange({
                ...draft,
                memory: { ...draft.memory, sharedReadOnly },
              });
            }}
          />
          <div className="dx-actions">
            <button
              type="button"
              className="dx-button"
              disabled={props.busy || props.isNew}
              onClick={() => {
                props.onInspectMemory("");
              }}
            >
              Inspect memory
            </button>
            <button
              type="button"
              className="dx-button dx-button--danger"
              disabled={
                props.busy ||
                props.isNew ||
                draft.memory.namespace.trim() === ""
              }
              onClick={props.onClearMemory}
            >
              Clear private namespace
            </button>
          </div>
          {props.memory.error === "" ? null : (
            <StatusLine tone="error">{props.memory.error}</StatusLine>
          )}
          {props.memory.result === null ? null : (
            <>
              <table className="dx-table">
                <thead>
                  <tr>
                    <th>Namespace</th>
                    <th>Access</th>
                    <th>Records</th>
                  </tr>
                </thead>
                <tbody>
                  {props.memory.result.namespaces.map((view) => (
                    <tr key={view.namespace}>
                      <td className="dx-mono">{view.namespace}</td>
                      <td>{view.access}</td>
                      <td>{String(view.records)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="dx-log">
                {props.memory.result.records.map((record) => (
                  <li
                    className="dx-log-item"
                    key={`${record.namespace}/${record.key}`}
                  >
                    <span className="dx-mono">
                      {record.namespace}/{record.key}
                    </span>{" "}
                    {record.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      ) : null}

      {tab === "Tools" ? (
        <ToolsSection
          draft={draft}
          onChange={onChange}
          catalog={props.catalog}
          infrastructure={
            props.profile?.tools.filter(
              (tool) => tool.kind === "infrastructure",
            ) ?? []
          }
        />
      ) : null}

      {tab === "Delegation" ? (
        <Section
          title="Cross-domain policy"
          note="Foreign domains are reached through their expert. Direct reads are refused outside the mode that allows them."
        >
          <Toggle
            checked={draft.delegation.allowCrossDomain}
            label="Allow this expert to reach other domains"
            onChange={(allowCrossDomain) => {
              onChange({
                ...draft,
                delegation: { ...draft.delegation, allowCrossDomain },
              });
            }}
          />
          <Select
            label="Cross-domain mode"
            value={draft.delegation.crossDomainMode}
            options={CROSS_DOMAIN_MODES.map((mode) => ({
              value: mode,
              label: mode,
            }))}
            hint="expert-only is the recommended default: ask the owning expert, never read its resources."
            onChange={(value) => {
              onChange({
                ...draft,
                delegation: {
                  ...draft.delegation,
                  crossDomainMode: value as CrossDomainMode,
                },
              });
            }}
          />
          <ListEditor
            label="Allowed target domains"
            hint="Empty means any other enabled domain."
            placeholder="inventory"
            values={draft.delegation.targets}
            onChange={(targets) => {
              onChange({
                ...draft,
                delegation: { ...draft.delegation, targets },
              });
            }}
          />
          <div className="dx-row">
            <TextInput
              label="Max delegation depth"
              type="number"
              value={String(draft.delegation.maxDepth)}
              hint="Enforced by the subagent runtime."
              onChange={(value) => {
                onChange({
                  ...draft,
                  delegation: {
                    ...draft.delegation,
                    maxDepth: toInt(value, 0),
                  },
                });
              }}
            />
            <TextInput
              label="Max parallel experts"
              type="number"
              value={String(draft.delegation.maxParallel)}
              hint="Enforced by the plugin per calling session."
              onChange={(value) => {
                onChange({
                  ...draft,
                  delegation: {
                    ...draft.delegation,
                    maxParallel: toInt(value, 1),
                  },
                });
              }}
            />
          </div>
          {draft.delegation.crossDomainMode === "direct-read" ? (
            <ListEditor
              label="Directly readable foreign namespaces"
              hint="Only used in direct-read mode."
              placeholder="domain/inventory"
              values={draft.delegation.directRead}
              onChange={(directRead) => {
                onChange({
                  ...draft,
                  delegation: { ...draft.delegation, directRead },
                });
              }}
            />
          ) : null}
        </Section>
      ) : null}

      {tab === "Model" ? (
        <Section
          title="Model"
          note="Inheriting the caller's route is almost always right. Pin a route only when the domain needs a different model."
        >
          <Toggle
            checked={draft.model.inherit}
            label="Inherit from the caller"
            onChange={(inherit) => {
              onChange({ ...draft, model: { ...draft.model, inherit } });
            }}
          />
          {draft.model.inherit ? null : (
            <>
              <div className="dx-row">
                <TextInput
                  label="Provider"
                  value={draft.model.provider}
                  onChange={(provider) => {
                    onChange({ ...draft, model: { ...draft.model, provider } });
                  }}
                />
                <TextInput
                  label="Model"
                  value={draft.model.model}
                  onChange={(model) => {
                    onChange({ ...draft, model: { ...draft.model, model } });
                  }}
                />
              </div>
              <div className="dx-row">
                <TextInput
                  label="Reasoning effort"
                  value={draft.model.reasoningEffort}
                  hint="Provider-specific identifier; leave empty to inherit."
                  onChange={(reasoningEffort) => {
                    onChange({
                      ...draft,
                      model: { ...draft.model, reasoningEffort },
                    });
                  }}
                />
                <TextInput
                  label="Max tokens"
                  type="number"
                  value={String(draft.model.maxTokens)}
                  hint="0 means no override."
                  onChange={(value) => {
                    onChange({
                      ...draft,
                      model: { ...draft.model, maxTokens: toInt(value, 0) },
                    });
                  }}
                />
              </div>
            </>
          )}
        </Section>
      ) : null}

      {tab === "Test" ? (
        <Section
          title="Test"
          note="Run the expert with a real task. It starts an ordinary subagent of the addressed session, so it appears in the session tree."
        >
          <TestTab
            draft={draft}
            test={props.test}
            disabled={props.isNew || props.busy}
            onChange={onChange}
            onRunTest={props.onRunTest}
          />
        </Section>
      ) : null}

      <div className="dx-actions">
        <button
          type="button"
          className="dx-button dx-button--primary"
          disabled={props.busy}
          onClick={props.onSave}
        >
          {props.isNew ? "Create domain" : "Save"}
        </button>
        <button
          type="button"
          className="dx-button"
          disabled={props.busy}
          onClick={props.onCancel}
        >
          Close
        </button>
        {props.isNew ? null : (
          <button
            type="button"
            className="dx-button dx-button--danger"
            disabled={props.busy}
            onClick={props.onDelete}
          >
            Delete
          </button>
        )}
        <StatusLine tone={props.status.tone}>{props.status.text}</StatusLine>
      </div>

      {props.profileError === "" ? null : (
        <StatusLine tone="error">{props.profileError}</StatusLine>
      )}
      {props.profile === null ? null : (
        <ScopeInspector profile={props.profile} />
      )}
    </div>
  );
}

function ToolsSection({
  draft,
  onChange,
  catalog,
  infrastructure,
}: {
  readonly draft: DomainDefinition;
  readonly onChange: (next: DomainDefinition) => void;
  readonly catalog: CatalogInfo;
  readonly infrastructure: readonly {
    readonly name: string;
    readonly note: string;
  }[];
}) {
  const allow = new Set(draft.tools.allow);
  const toggle = (name: string, on: boolean): void => {
    const next = new Set(allow);
    if (on) next.add(name);
    else next.delete(name);
    onChange({ ...draft, tools: { ...draft.tools, allow: [...next].sort() } });
  };
  const options = [
    ...catalog.workers.map((worker) => ({
      name: worker.id,
      title: worker.title,
      note:
        worker.enforces.length > 0
          ? `worker; enforces ${worker.enforces.join(", ")}`
          : "worker",
    })),
    ...catalog.tools.map((tool) => ({
      name: tool.name,
      title: tool.name,
      note: "plugin tool",
    })),
    ...infrastructure.map((tool) => ({
      name: tool.name,
      title: tool.name,
      note: "infrastructure",
    })),
  ];
  const seen = new Set<string>();
  const unique = options.filter((option) => {
    if (seen.has(option.name)) return false;
    seen.add(option.name);
    return true;
  });

  return (
    <Section
      title="Tools"
      note="Only these global tools stay visible to the expert. Everything else disappears from its view and refuses to execute."
    >
      {unique.length === 0 ? (
        <p className="dx-empty">
          No workers or plugin tools are registered in this deployment.
        </p>
      ) : (
        unique.map((option) => (
          <Toggle
            key={option.name}
            checked={allow.has(option.name)}
            label={`${option.name} — ${option.note}`}
            onChange={(on) => {
              toggle(option.name, on);
            }}
          />
        ))
      )}

      <ListEditor
        label="Additional allowed tool names"
        hint="Names the plugin cannot verify are passed to the harness as-is; the child start fails loudly if such a name is unknown."
        placeholder="bash"
        values={draft.tools.allow.filter(
          (name) => !unique.some((option) => option.name === name),
        )}
        onChange={(extra) => {
          const known = draft.tools.allow.filter((name) =>
            unique.some((option) => option.name === name),
          );
          onChange({
            ...draft,
            tools: { ...draft.tools, allow: [...known, ...extra].sort() },
          });
        }}
      />
      <ListEditor
        label="Denied tool names"
        placeholder="bash"
        values={draft.tools.deny}
        onChange={(deny) => {
          onChange({ ...draft, tools: { ...draft.tools, deny } });
        }}
      />
      {draft.tools.deny.length > 0 &&
      draft.tools.allow.some((n) => draft.tools.deny.includes(n)) ? (
        <StatusLine tone="error">
          A tool cannot be both allowed and denied; remove one of the entries.
        </StatusLine>
      ) : null}
    </Section>
  );
}

function TestTab({
  draft,
  test,
  disabled,
  onChange,
  onRunTest,
}: {
  readonly draft: DomainDefinition;
  readonly test: TestView;
  readonly disabled: boolean;
  readonly onChange: (next: DomainDefinition) => void;
  readonly onRunTest: (task: string) => void;
}) {
  const [task, setTask] = useState(
    "Explain how this domain's main flow works.",
  );
  const [mode, setMode] = useState<ExpertMode>("investigate");
  return (
    <>
      <TextArea label="Task" value={task} rows={3} onChange={setTask} />
      <Select
        label="Mode"
        value={mode}
        options={EXPERT_MODES.map((value) => ({ value, label: value }))}
        onChange={(value) => {
          setMode(value as ExpertMode);
        }}
      />
      <div className="dx-actions">
        <button
          type="button"
          className="dx-button dx-button--primary"
          disabled={disabled || test.running || task.trim() === ""}
          onClick={() => {
            onChange(draft);
            onRunTest(task.trim());
          }}
        >
          {test.running ? "Running…" : "Run test"}
        </button>
      </div>
      {test.error === "" ? null : (
        <StatusLine tone="error">{test.error}</StatusLine>
      )}
      {test.summary === "" ? null : (
        <>
          <StatusLine>status {test.status}</StatusLine>
          <p className="dx-section-note" style={{ whiteSpace: "pre-wrap" }}>
            {test.summary}
          </p>
        </>
      )}
      {test.findings.length === 0 ? null : (
        <table className="dx-table">
          <thead>
            <tr>
              <th>Confidence</th>
              <th>Claim</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {test.findings.map((finding, index) => (
              <tr key={`${finding.claim}-${String(index)}`}>
                <td>{finding.confidence}</td>
                <td>{finding.claim}</td>
                <td className="dx-mono">{finding.evidence.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
