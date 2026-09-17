/**
 * The JSON view: a tree and a raw mode over the same document.
 *
 * The value rendered here is the analysis exactly as it was published, not a
 * normalised view of it. That is what makes the tab useful for an audit whose
 * schema this build does not know (SPEC §8) and for a field the semantic view
 * does not model.
 *
 * Everything renders as text: a string containing markup is characters, not
 * nodes, and a key or value is never interpolated into HTML (SPEC §62).
 */
import { useMemo, useState, type ReactNode } from "react";

/** Above this size the tree would cost more than it shows, so raw wins. */
const MAX_TREE_CHARACTERS = 512 * 1024;

/** A JSON container. */
function isContainer(
  value: unknown,
): value is Record<string, unknown> | unknown[] {
  return typeof value === "object" && value !== null;
}

/** The path notation used for display and copying. */
function childPath(path: string, key: string, index?: number): string {
  if (index !== undefined) return `${path}[${index}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

/** Every path in the document whose key or scalar value contains `query`. */
function collectMatches(value: unknown, query: string): Set<string> {
  const matched = new Set<string>();
  const needle = query.toLowerCase();

  const walk = (node: unknown, path: string): boolean => {
    let hit = path.toLowerCase().includes(needle);
    if (isContainer(node)) {
      const entries: [string, unknown][] = Array.isArray(node)
        ? node.map((item, index) => [String(index), item] as [string, unknown])
        : Object.entries(node);
      for (const [key, child] of entries) {
        if (key.toLowerCase().includes(needle)) hit = true;
        const next = Array.isArray(node)
          ? childPath(path, key, Number(key))
          : childPath(path, key);
        if (walk(child, next)) hit = true;
      }
    } else if (String(node).toLowerCase().includes(needle)) {
      hit = true;
    }
    if (hit) matched.add(path);
    return hit;
  };

  walk(value, "$");
  return matched;
}

interface NodeProps {
  readonly name: string;
  readonly path: string;
  readonly value: unknown;
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
  readonly matched: ReadonlySet<string> | null;
  /** The active filter, for marking the needle inside a visible row. */
  readonly query: string;
  readonly onCopy: (text: string) => void;
}

function highlight(text: string, query: string): ReactNode {
  if (query.length === 0) return text;
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="dsh-audit-json__mark">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}

function JsonNode(props: NodeProps): ReactNode {
  const {
    name,
    path,
    value,
    depth,
    expanded,
    onToggle,
    matched,
    query,
    onCopy,
  } = props;
  const isOpen = expanded.has(path);

  if (!isContainer(value)) {
    const rendered =
      value === null
        ? "null"
        : typeof value === "string"
          ? JSON.stringify(value)
          : String(value);
    return (
      <div className="dsh-audit-json__row dsh-audit-json__row--leaf">
        <span className="dsh-audit-json__gutter" />
        <button
          type="button"
          className="dsh-audit-json__key"
          title={`Copy the path ${path}`}
          onClick={() => onCopy(path)}
        >
          {highlight(name, query)}
        </button>
        <span className="dsh-audit-json__colon">:</span>
        <button
          type="button"
          className={`dsh-audit-json__value dsh-audit-json__value--${value === null ? "null" : typeof value}`}
          title="Copy this value"
          onClick={() => onCopy(value === null ? "null" : String(value))}
        >
          {highlight(rendered, query)}
        </button>
      </div>
    );
  }

  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as [string, unknown])
    : Object.entries(value);
  const label = Array.isArray(value)
    ? `[${entries.length}]`
    : `{${entries.length}}`;

  return (
    <div className="dsh-audit-json__node">
      <div className="dsh-audit-json__row">
        <button
          type="button"
          className="dsh-audit-json__toggle"
          aria-expanded={isOpen}
          aria-label={isOpen ? `Collapse ${name}` : `Expand ${name}`}
          onClick={() => onToggle(path)}
        >
          <svg
            className={
              isOpen
                ? "dsh-audit-json__chevron dsh-audit-json__chevron--open"
                : "dsh-audit-json__chevron"
            }
            viewBox="0 0 14 14"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="m3.5 5.25 3.5 3.5 3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="dsh-audit-json__key"
          title={`Copy the path ${path}`}
          onClick={() => onCopy(path)}
        >
          {highlight(name, query)}
        </button>
        <span className="dsh-audit-json__colon">:</span>
        <span className="dsh-audit-json__summary">{label}</span>
      </div>
      {isOpen ? (
        <div className="dsh-audit-json__children">
          {entries.map(([key, child]) => {
            const nextPath = Array.isArray(value)
              ? childPath(path, key, Number(key))
              : childPath(path, key);
            // A filter prunes branches rather than merely highlighting them:
            // a "search" that still showed every non-matching row would be a
            // highlighter with the tree's cost.
            if (matched !== null && !matched.has(nextPath)) return null;
            return (
              <JsonNode
                key={nextPath}
                name={key}
                path={nextPath}
                value={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                matched={matched}
                query={query}
                onCopy={onCopy}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export interface AuditJsonTreeProps {
  /** The decoded document, exactly as published. */
  readonly value: unknown;
  /** Shown in the raw mode's header. */
  readonly rawLabel?: string;
}

export function AuditJsonTree(props: AuditJsonTreeProps): ReactNode {
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(["$"]),
  );

  const raw = useMemo(() => {
    try {
      return JSON.stringify(props.value, null, 2);
    } catch {
      return String(props.value);
    }
  }, [props.value]);

  const matched = useMemo(
    () =>
      query.trim().length === 0
        ? null
        : collectMatches(props.value, query.trim()),
    [props.value, query],
  );

  // A search opens exactly what it found — and only that. Outside a search the
  // reader's own expansion is the whole answer, so collapsing everything stays
  // collapsed instead of being undone by a default.
  const effectiveExpanded = matched ?? expanded;

  const tooLarge = raw.length > MAX_TREE_CHARACTERS;
  const activeMode = tooLarge ? "raw" : mode;

  const copy = (text: string): void => {
    setCopied(text);
    const clipboard =
      typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard !== undefined) void clipboard.writeText(text).catch(() => {});
    setTimeout(() => setCopied(""), 1200);
  };

  const toggle = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="dsh-audit-json">
      <div className="dsh-audit-json__bar">
        <div
          className="dsh-audit-json__modes"
          role="tablist"
          aria-label="JSON view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === "tree"}
            className={
              activeMode === "tree"
                ? "dsh-audit-json__mode dsh-audit-json__mode--active"
                : "dsh-audit-json__mode"
            }
            onClick={() => setMode("tree")}
            disabled={tooLarge}
          >
            Tree
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === "raw"}
            className={
              activeMode === "raw"
                ? "dsh-audit-json__mode dsh-audit-json__mode--active"
                : "dsh-audit-json__mode"
            }
            onClick={() => setMode("raw")}
          >
            Raw
          </button>
        </div>

        {activeMode === "tree" ? (
          <>
            <input
              className="dsh-audit-json__search"
              type="search"
              value={query}
              placeholder="Filter keys and values"
              aria-label="Filter JSON"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              type="button"
              className="dsh-audit-json__action"
              onClick={() => setExpanded(new Set())}
            >
              Collapse all
            </button>
            <button
              type="button"
              className="dsh-audit-json__action"
              onClick={() =>
                setExpanded(
                  expandToDepth(
                    props.value,
                    Number.POSITIVE_INFINITY,
                    new Set(),
                  ),
                )
              }
            >
              Expand all
            </button>
          </>
        ) : (
          <button
            type="button"
            className="dsh-audit-json__action"
            onClick={() => copy(raw)}
          >
            {copied === raw ? "Copied" : "Copy all"}
          </button>
        )}
      </div>

      {tooLarge ? (
        <p className="dsh-audit-json__note">
          The document is too large to render as a tree, so it is shown raw.
        </p>
      ) : null}

      {activeMode === "tree" ? (
        <div className="dsh-audit-json__tree" role="tree">
          {matched !== null && matched.size === 0 ? (
            <p className="dsh-audit-json__note">Nothing matches this filter.</p>
          ) : null}
          <JsonNode
            name="$"
            path="$"
            value={props.value}
            depth={0}
            expanded={effectiveExpanded}
            onToggle={toggle}
            matched={matched}
            query={query.trim()}
            onCopy={copy}
          />
        </div>
      ) : (
        <pre className="dsh-audit-json__raw">{raw}</pre>
      )}

      {copied.length > 0 && copied !== raw ? (
        <p className="dsh-audit-json__note" role="status">
          Copied{" "}
          <code>{copied.length > 60 ? `${copied.slice(0, 60)}…` : copied}</code>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Expand a container down to `depth`, keeping whatever the reader opened.
 *
 * Depth counts *open containers*, not visible levels: at depth 1 the root is
 * open and its children are visible but collapsed, which is what "expand the
 * first level" means to a reader.
 */
function expandToDepth(
  value: unknown,
  depth: number,
  base: ReadonlySet<string>,
): ReadonlySet<string> {
  const next = new Set(base);
  const walk = (node: unknown, path: string, level: number): void => {
    if (level >= depth) return;
    next.add(path);
    if (!isContainer(node)) return;
    const entries: [string, unknown][] = Array.isArray(node)
      ? node.map((item, index) => [String(index), item] as [string, unknown])
      : Object.entries(node);
    for (const [key, child] of entries) {
      walk(
        child,
        Array.isArray(node)
          ? childPath(path, key, Number(key))
          : childPath(path, key),
        level + 1,
      );
    }
  };
  walk(value, "$", 0);
  return next;
}
