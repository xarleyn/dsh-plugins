import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptyDomainDraft,
  type AuditListResult,
  type CatalogInfo,
  type DomainDefinition,
  type DomainExpertFinding,
  type DomainSummary,
  type DraftInspectionResult,
  type MemoryInspectResult,
  type ResolvedExpertProfile,
  type ValidationIssueView,
} from "../types.js";
import type { ApiOutcome } from "./remote.js";
import {
  DomainEditor,
  type MemoryView,
  type RunsView,
  type TestView,
} from "./DomainEditor.js";
import { StatusLine } from "./components.js";

/** The subset of the Remote surface this page uses. */
export interface DomainExpertsApi {
  listDomains(): Promise<
    ApiOutcome<{ readonly domains: readonly DomainSummary[] }>
  >;
  getDomain(
    id: string,
  ): Promise<ApiOutcome<{ readonly domain: DomainDefinition | null }>>;
  draftDomain(
    id: string,
  ): Promise<ApiOutcome<{ readonly domain: DomainDefinition | null }>>;
  inspectDraft(
    definition: DomainDefinition,
  ): Promise<ApiOutcome<DraftInspectionResult>>;
  createDomain(
    definition: DomainDefinition,
  ): Promise<ApiOutcome<{ readonly domain: DomainDefinition | null }>>;
  updateDomain(
    definition: DomainDefinition,
  ): Promise<ApiOutcome<{ readonly domain: DomainDefinition | null }>>;
  setDomainEnabled(
    id: string,
    enabled: boolean,
  ): Promise<ApiOutcome<{ readonly domain: DomainDefinition | null }>>;
  deleteDomain(id: string): Promise<ApiOutcome<{ readonly deleted: boolean }>>;
  resolveScope(
    id: string,
  ): Promise<ApiOutcome<{ readonly profile: ResolvedExpertProfile | null }>>;
  catalog(): Promise<ApiOutcome<CatalogInfo>>;
  inspectMemory(
    id: string,
    namespace: string,
    limit: number,
  ): Promise<ApiOutcome<MemoryInspectResult>>;
  clearMemory(
    id: string,
    namespace: string,
  ): Promise<ApiOutcome<{ readonly cleared: number }>>;
  testExpert(
    id: string,
    task: string,
    parentSessionId: string,
  ): Promise<
    ApiOutcome<{
      readonly result: {
        readonly summary: string;
        readonly status: string;
        readonly findings: readonly DomainExpertFinding[];
      } | null;
    }>
  >;
  /**
   * Runs the host still remembers, newest first. The page filters them by the
   * domain it is showing, so one answer serves every domain.
   */
  recentAudits(limit: number): Promise<ApiOutcome<AuditListResult>>;
}

/**
 * How much of the host's audit ring one request asks for.
 *
 * The ring is capped by the plugin's `auditLimit` and holds entries of every
 * domain, so the page asks for more than it could ever need: a smaller limit
 * would answer with the newest page of the ring and quietly hide this domain's
 * older runs.
 */
const RUNS_LIMIT = 500;

const EMPTY_CATALOG: CatalogInfo = {
  scopeProviders: [],
  memoryProviders: [],
  workers: [],
  tools: [],
  memoryNamespaces: [],
};

const QUIET: { readonly tone: "info" | "error"; readonly text: string } = {
  tone: "info",
  text: "",
};

/**
 * Management page mounted in the Plugins settings section.
 *
 * The page is a thin client of the host service: it holds the draft being
 * edited and renders the host's answers, and never decides policy itself. That
 * is what keeps CLI and API use of the same service possible later.
 *
 * The list and the editor share one pane. They were two wrapping flex columns
 * until the settings dialog turned out to be narrower than their combined
 * minimum: the editor rendered below a list of eight cards, out of view, so
 * picking a domain looked like it had done nothing at all. One pane at a time
 * needs no width assumptions, which is the one thing this page cannot make:
 * the dialog width is the host's choice.
 */
export function DomainExpertsPage({
  api,
  currentSessionId,
}: {
  readonly api: DomainExpertsApi;
  readonly currentSessionId: () => string;
}) {
  const [domains, setDomains] = useState<readonly DomainSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogInfo>(EMPTY_CATALOG);
  const [draft, setDraft] = useState<DomainDefinition | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [issues, setIssues] = useState<readonly ValidationIssueView[]>([]);
  const [profile, setProfile] = useState<ResolvedExpertProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [busy, setBusy] = useState(false);
  /*
   * Two status channels because they are read in two places: `status` sits in
   * the editor next to Save, `pageStatus` on the list, which is the only
   * surface left when a list-level action fails.
   */
  const [status, setStatus] = useState(QUIET);
  const [pageStatus, setPageStatus] = useState(QUIET);
  /** Serialized form of the draft as loaded or last saved, for the discard guard. */
  const [baseline, setBaseline] = useState("");
  const [loadError, setLoadError] = useState("");
  const [newId, setNewId] = useState("");
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [memory, setMemory] = useState<MemoryView>({ result: null, error: "" });
  const [test, setTest] = useState<TestView>({
    running: false,
    summary: "",
    status: "",
    findings: [],
    error: "",
  });
  const [runs, setRuns] = useState<RunsView>({ entries: [], error: "" });
  const editing = draft !== null;

  const refresh = useCallback(async (): Promise<void> => {
    const [listed, described] = await Promise.all([
      api.listDomains(),
      api.catalog(),
    ]);
    if (!listed.ok) {
      setLoadError(`${listed.code}: ${listed.message}`);
      setDomains([]);
    } else {
      setLoadError("");
      setDomains(listed.data.domains);
    }
    if (described.ok) setCatalog(described.data);
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /*
   * Opening a domain replaces the control the user just clicked, so focus
   * follows the content instead of being dropped on the document body.
   */
  useEffect(() => {
    if (!editing) return;
    detailRef.current?.focus();
  }, [editing]);

  const loadProfile = useCallback(
    async (domainId: string): Promise<void> => {
      const resolved = await api.resolveScope(domainId);
      if (!resolved.ok) {
        setProfile(null);
        setProfileError(`${resolved.code}: ${resolved.message}`);
        return;
      }
      setProfileError("");
      setProfile(resolved.data.profile);
    },
    [api],
  );

  /**
   * The run history of one domain, read from the host's audit ring.
   *
   * The host records every run whatever started it, so an expert opened from a
   * conversation through the agents panel is listed here exactly like one the
   * Test tab started — that equality is the point of the list.
   */
  const loadRuns = useCallback(
    async (domainId: string): Promise<void> => {
      const outcome = await api.recentAudits(RUNS_LIMIT);
      if (!outcome.ok) {
        setRuns({ entries: [], error: `${outcome.code}: ${outcome.message}` });
        return;
      }
      setRuns({
        entries: outcome.data.entries.filter(
          (entry) => entry.domainId === domainId,
        ),
        error: "",
      });
    },
    [api],
  );

  const openDomain = useCallback(
    async (domainId: string): Promise<void> => {
      setIsNew(false);
      setStatus(QUIET);
      setPageStatus(QUIET);
      setProfile(null);
      setProfileError("");
      setMemory({ result: null, error: "" });
      setRuns({ entries: [], error: "" });
      setTest({
        running: false,
        summary: "",
        status: "",
        findings: [],
        error: "",
      });
      const loaded = await api.getDomain(domainId);
      if (!loaded.ok || loaded.data.domain === null) {
        setDraft(null);
        setBaseline("");
        setPageStatus({
          tone: "error",
          text: loaded.ok
            ? "The domain no longer exists."
            : `${loaded.code}: ${loaded.message}`,
        });
        return;
      }
      setDraft(loaded.data.domain);
      setBaseline(JSON.stringify(loaded.data.domain));
      setIssues([]);
      await Promise.all([loadProfile(domainId), loadRuns(domainId)]);
    },
    [api, loadProfile, loadRuns],
  );

  /**
   * Leaving the editor drops whatever was typed into it. The draft is compared
   * against the definition it was loaded from, so a stray click on the way back
   * cannot silently throw away a persona.
   */
  const confirmDiscard = useCallback((): boolean => {
    if (draft === null || JSON.stringify(draft) === baseline) return true;
    return window.confirm(
      `Discard unsaved changes to "${draft.name || draft.id}"?`,
    );
  }, [baseline, draft]);

  const backToList = useCallback((): void => {
    if (!confirmDiscard()) return;
    setDraft(null);
    setBaseline("");
    setProfile(null);
    setProfileError("");
    setRuns({ entries: [], error: "" });
    setStatus(QUIET);
  }, [confirmDiscard]);

  const startNew = useCallback(async (): Promise<void> => {
    const id = newId.trim();
    if (id === "") return;
    if (!confirmDiscard()) return;
    const seeded = await api.draftDomain(id);
    const fallback = emptyDomainDraft(id, Date.now());
    const next =
      seeded.ok && seeded.data.domain !== null ? seeded.data.domain : fallback;
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setIsNew(true);
    setIssues([]);
    setProfile(null);
    setProfileError("");
    setMemory({ result: null, error: "" });
    setRuns({ entries: [], error: "" });
    setStatus(QUIET);
    setPageStatus(QUIET);
    setNewId("");
  }, [api, confirmDiscard, newId]);

  /** Live validation so the user sees a bad path before saving it. */
  const change = useCallback(
    (next: DomainDefinition): void => {
      setDraft(next);
      void api.inspectDraft(next).then((outcome) => {
        if (!outcome.ok) return;
        setIssues(outcome.data.issues);
      });
    },
    [api],
  );

  const save = useCallback(async (): Promise<void> => {
    if (draft === null) return;
    setBusy(true);
    setStatus({ tone: "info", text: "Saving…" });
    const outcome = isNew
      ? await api.createDomain(draft)
      : await api.updateDomain(draft);
    setBusy(false);
    if (!outcome.ok) {
      setStatus({ tone: "error", text: `${outcome.code}: ${outcome.message}` });
      return;
    }
    if (outcome.data.domain === null) {
      setStatus({
        tone: "error",
        text: "The host did not return the saved domain.",
      });
      return;
    }
    setDraft(outcome.data.domain);
    setBaseline(JSON.stringify(outcome.data.domain));
    const created = isNew;
    setIsNew(false);
    setStatus({
      tone: "info",
      text: created ? "Domain created." : "Changes saved.",
    });
    await refresh();
    await loadProfile(outcome.data.domain.id);
  }, [api, draft, isNew, loadProfile, refresh]);

  const remove = useCallback(async (): Promise<void> => {
    if (draft === null || isNew) return;
    if (
      !window.confirm(
        `Delete domain "${draft.id}"? Its private memory stays in storage.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const outcome = await api.deleteDomain(draft.id);
    setBusy(false);
    if (!outcome.ok) {
      setStatus({ tone: "error", text: `${outcome.code}: ${outcome.message}` });
      return;
    }
    setDraft(null);
    setBaseline("");
    setProfile(null);
    setStatus(QUIET);
    setPageStatus({ tone: "info", text: "Domain deleted." });
    await refresh();
  }, [api, draft, isNew, refresh]);

  const toggleEnabled = useCallback(
    async (domainId: string, enabled: boolean): Promise<void> => {
      const outcome = await api.setDomainEnabled(domainId, enabled);
      if (!outcome.ok) {
        setPageStatus({
          tone: "error",
          text: `${outcome.code}: ${outcome.message}`,
        });
        return;
      }
      setPageStatus(QUIET);
      await refresh();
      if (draft?.id === domainId) await loadProfile(domainId);
    },
    [api, draft, loadProfile, refresh],
  );

  const inspectMemory = useCallback(
    async (namespace: string): Promise<void> => {
      const domainId = draft?.id;
      if (domainId === undefined) return;
      setBusy(true);
      const outcome = await api.inspectMemory(domainId, namespace, 100);
      setBusy(false);
      if (!outcome.ok) {
        setMemory({
          result: null,
          error: `${outcome.code}: ${outcome.message}`,
        });
        return;
      }
      setMemory({ result: outcome.data, error: "" });
    },
    [api, draft],
  );

  const clearMemory = useCallback(async (): Promise<void> => {
    const domainId = draft?.id;
    if (domainId === undefined) return;
    if (
      !window.confirm(
        `Clear the private memory namespace of "${domainId}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    const outcome = await api.clearMemory(domainId, "");
    setBusy(false);
    if (!outcome.ok) {
      setMemory({ result: null, error: `${outcome.code}: ${outcome.message}` });
      return;
    }
    setMemory({ result: null, error: "" });
    setStatus({
      tone: "info",
      text: `Cleared ${String(outcome.data.cleared)} records.`,
    });
  }, [api, draft]);

  const runTest = useCallback(
    async (task: string): Promise<void> => {
      const domainId = draft?.id;
      if (domainId === undefined) return;
      setTest({
        running: true,
        summary: "",
        status: "",
        findings: [],
        error: "",
      });
      const outcome = await api.testExpert(domainId, task, currentSessionId());
      if (!outcome.ok) {
        setTest({
          running: false,
          summary: "",
          status: "",
          findings: [],
          error: `${outcome.code}: ${outcome.message}`,
        });
        return;
      }
      const result = outcome.data.result;
      setTest({
        running: false,
        summary: result?.summary ?? "",
        status: result?.status ?? "",
        findings: result?.findings ?? [],
        error: "",
      });
      // The test run is a run like any other, so it lands in the history the
      // moment it is over.
      await Promise.all([refresh(), loadRuns(domainId)]);
    },
    [api, currentSessionId, draft, loadRuns, refresh],
  );

  const sorted = useMemo(
    () =>
      [...domains].sort((left, right) =>
        left.name.localeCompare(right.name, "en"),
      ),
    [domains],
  );

  return (
    <div className="dx-page">
      <header className="dx-header">
        <div>
          <h2 className="dx-title">Domain Experts</h2>
          <p className="dx-subtitle">
            A domain expert is a persona bound to a scope, a memory namespace
            and a tool policy. The expert runs as an ordinary subagent of the
            caller.
          </p>
        </div>
        <div className="dx-actions">
          <span className="dx-count">
            {String(sorted.length)} domain{sorted.length === 1 ? "" : "s"}
          </span>
          <input
            className="dx-input"
            style={{ width: "160px" }}
            placeholder="new-domain-id"
            value={newId}
            onChange={(event) => {
              setNewId(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void startNew();
            }}
          />
          <button
            type="button"
            className="dx-button dx-button--primary"
            disabled={newId.trim() === ""}
            onClick={() => {
              void startNew();
            }}
          >
            Add domain
          </button>
        </div>
      </header>

      {loadError === "" ? null : (
        <StatusLine tone="error">{loadError}</StatusLine>
      )}
      {pageStatus.text === "" ? null : (
        <StatusLine tone={pageStatus.tone}>{pageStatus.text}</StatusLine>
      )}

      {editing ? null : (
        <ul className="dx-list">
          {sorted.length === 0 ? (
            <li className="dx-empty">
              No domains yet. Create one to give a part of the product its own
              expert.
            </li>
          ) : (
            sorted.map((domain) => (
              <li className="dx-list-card" key={domain.id}>
                {/*
                 * Selecting and enabling are two different actions, so they
                 * are two sibling controls: nesting a toggle inside the card
                 * button would produce invalid interactive markup and a
                 * keyboard trap.
                 */}
                <button
                  type="button"
                  className="dx-list-item"
                  onClick={() => {
                    void openDomain(domain.id);
                  }}
                >
                  <span className="dx-list-name">
                    {domain.icon === "" ? null : (
                      <span aria-hidden="true">{domain.icon}</span>
                    )}
                    {domain.name}
                    <span
                      className={
                        domain.enabled ? "dx-chip" : "dx-chip dx-chip--advisory"
                      }
                    >
                      {domain.enabled ? "enabled" : "disabled"}
                    </span>
                    {domain.degradations > 0 ? (
                      <span className="dx-chip dx-chip--warning">
                        {String(domain.degradations)} degraded
                      </span>
                    ) : null}
                  </span>
                  <span className="dx-list-desc">
                    {domain.description || "No description."}
                  </span>
                  <span className="dx-list-meta">
                    {String(domain.primaryPaths)} primary paths ·{" "}
                    {String(domain.sharedPaths)} shared ·{" "}
                    {String(domain.memoryNamespaces)} memory namespaces ·{" "}
                    {String(domain.tools)} tools
                  </span>
                </button>
                <div className="dx-list-actions">
                  {/*
                   * The card body opens the editor too, but nothing on screen
                   * says so. The label is what makes editing discoverable at
                   * all, and a card that only offers "Disable" reads as a
                   * record that cannot be changed.
                   */}
                  <button
                    type="button"
                    className="dx-button dx-button--small"
                    aria-label={`Edit ${domain.name}`}
                    onClick={() => {
                      void openDomain(domain.id);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="dx-button dx-button--small"
                    aria-pressed={!domain.enabled}
                    onClick={() => {
                      void toggleEnabled(domain.id, !domain.enabled);
                    }}
                  >
                    {domain.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      )}

      {editing ? (
        <div className="dx-detail" ref={detailRef} tabIndex={-1}>
          {/*
           * The way back sits above the form rather than at its foot: the
           * editor runs to nine tabs, so a control that only exists next to
           * Save is a control nobody finds.
           */}
          <button
            type="button"
            className="dx-button dx-button--small dx-back"
            onClick={backToList}
          >
            <svg
              aria-hidden="true"
              className="dx-back-icon"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 7H3M6.5 3.5 3 7l3.5 3.5" />
            </svg>
            All domains
          </button>
          <DomainEditor
            draft={draft}
            isNew={isNew}
            busy={busy}
            status={status}
            issues={issues}
            catalog={catalog}
            profile={profile}
            profileError={profileError}
            memory={memory}
            test={test}
            runs={runs}
            onChange={change}
            onSave={() => {
              void save();
            }}
            onDelete={() => {
              void remove();
            }}
            onInspectMemory={(namespace) => {
              void inspectMemory(namespace);
            }}
            onClearMemory={() => {
              void clearMemory();
            }}
            onRunTest={(task) => {
              void runTest(task);
            }}
            onRefreshRuns={() => {
              if (draft === null) return;
              void loadRuns(draft.id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
