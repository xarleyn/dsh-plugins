// dsh-session-scope — web client half.
//
// This module is the source of the package's browser bundle, not the bundle
// itself: tsdown wraps it into the classic ModuleLoader script served at
// /plugins/@yadsh/dsh-session-scope/client.js. The registration
// (`window.__ModuleLoader__.load({ id, factory })`, `id` being the full package
// name) and the factory closure come from the build banner, so this module only
// exports the Cordis client plugin. It requires only `react` and `react-dom`
// (both are shell statics); everything else comes from client services
// (`slots`, `remote`, `sessions`).
//
// It contributes an independent Scope chip beside the Workspace picker while
// a session is blank and beside the permission selector after the first turn.
// The editor consumes state and host capabilities from the `session-scope`
// projection and writes complete snapshots through `/scope`; permission and
// scope never share UI state.
// - The editor walks the directory tree beneath the session workspace and
//   toggles which directories the agent may write to, in addition to the
//   session workspace. Changes go through the host's
//   `/scope` command; the `session-scope` session projection
//   pushes the state back, so the button and the tree stay in sync with the
//   server.
//
// The editor renders through a React portal onto document.body with a high
// z-index, because the composer seat is `position: sticky` inside its own
// stacking context — an in-place fixed overlay would be clipped or buried.
//
// Directory listings come from the plugin's dedicated `sessionScope/list`
// RPC. Read-only UI refreshes never execute durable slash commands.

import * as React from "react";
import * as ReactDOM from "react-dom";

// ---------- copy ----------
const LANG =
  typeof navigator !== "undefined" && /^zh/i.test(navigator.language || "")
    ? "zh"
    : "en";
function L(zh: string, en: string): string {
  return LANG === "zh" ? zh : en;
}

// ---------- styling (cosmetic; never fail the plugin) ----------
const CSS = [
  ".wss-btnScope { box-sizing: border-box; height: 22px; display: inline-flex; align-items: center; gap: 4px; border: none; border-radius: 6px; background: var(--dsw-alias-fill-tsp-secondary); color: var(--dsw-alias-label-secondary); padding: 0 8px; font: inherit; font-size: 12px; line-height: 22px; cursor: pointer; white-space: nowrap; }",
  ".wss-btnScope:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }",
  ".wss-btnScope:disabled { cursor: default; opacity: .55; }",
  ".wss-btnScopeHero { height: 28px; min-height: 28px; border-radius: 16px; background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; font-weight: 500; }",
  ".wss-heroMount { display: contents; }",
  ".wss-heroProbe { display: none !important; }",
  ".wss-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }",
  ".wss-modal { box-sizing: border-box; width: min(560px, calc(100vw - 48px)); max-height: min(640px, calc(100vh - 96px)); display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--dsw-alias-border-inverted); background: var(--dsw-specific-menu); box-shadow: var(--dsw-shadow-lv3); border-radius: 14px; padding: 14px; color: var(--dsw-alias-label-primary); }",
  ".wss-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
  ".wss-title { font-size: 14px; font-weight: 600; line-height: 20px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".wss-close { display: inline-flex; border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 2px; border-radius: 6px; }",
  ".wss-close:hover { background: var(--dsw-alias-interactive-bg-hover); }",
  ".wss-caption { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.5; }",
  ".wss-modes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }",
  ".wss-mode { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); padding: 7px 8px; font: inherit; font-size: 12px; cursor: pointer; }",
  ".wss-mode:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }",
  ".wss-modeOn { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-fill-tsp-secondary); }",
  ".wss-modeUnavailable { opacity: .55; }",
  ".wss-crumbs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; font-size: 12px; line-height: 18px; }",
  ".wss-crumb { border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 1px 4px; border-radius: 6px; font: inherit; }",
  ".wss-crumb:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }",
  ".wss-crumbSep { color: var(--dsw-alias-label-caption); }",
  ".wss-tree { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 120px; --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }",
  ".wss-row { box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: none; background: transparent; color: var(--dsw-alias-label-primary); border-radius: 8px; padding: 5px 8px; cursor: pointer; font: inherit; }",
  ".wss-row:hover { background: var(--dsw-alias-interactive-bg-hover); }",
  ".wss-rowName { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".wss-rowNameDim { opacity: .55; }",
  ".wss-check { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: #fff; cursor: pointer; padding: 0; }",
  ".wss-check:hover:not(:disabled) { border-color: var(--dsw-alias-state-business-primary); }",
  ".wss-checkOn { background: var(--dsw-alias-state-business-primary); border-color: var(--dsw-alias-state-business-primary); }",
  ".wss-check:disabled { cursor: default; opacity: .6; }",
  ".wss-hint { color: var(--dsw-alias-label-caption); font-size: 10px; line-height: 14px; white-space: nowrap; }",
  ".wss-chevron { flex: none; display: inline-flex; color: var(--dsw-alias-label-caption); }",
  ".wss-foot { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 10px; }",
  ".wss-footRoots { min-width: 0; flex: 1; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
  ".wss-btn { border: none; border-radius: 8px; padding: 4px 12px; font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; white-space: nowrap; }",
  ".wss-btn:disabled { opacity: .5; cursor: default; }",
  ".wss-btnGhost { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }",
  ".wss-btnPrimary { background: var(--dsw-alias-button-info-fill); color: #fff; }",
  ".wss-btnDanger { background: transparent; color: var(--dsw-alias-state-error-primary); }",
  ".wss-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 1.5; }",
  ".wss-busy { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }",
  ".wss-empty { color: var(--dsw-alias-label-caption); font-size: 12px; line-height: 1.5; padding: 8px; }",
].join("\n");

// ---------- icons ----------
function IconFolder() {
  return React.createElement(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": true,
    },
    React.createElement("path", {
      d: "M2 3.5h4l1.5 2H14v7H2v-9Z",
      stroke: "currentColor",
      strokeWidth: 1.2,
      strokeLinejoin: "round",
    }),
  );
}
function IconChevron() {
  return React.createElement(
    "svg",
    {
      width: 12,
      height: 12,
      viewBox: "0 0 12 12",
      fill: "none",
      "aria-hidden": true,
    },
    React.createElement("path", {
      d: "M3 4.5L6 7.5L9 4.5",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}
function IconCheck() {
  return React.createElement(
    "svg",
    {
      width: 10,
      height: 10,
      viewBox: "0 0 12 12",
      fill: "none",
      "aria-hidden": true,
    },
    React.createElement("path", {
      d: "M2.5 6.5L5 9L9.5 3.5",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
}
function IconClose() {
  return React.createElement(
    "svg",
    {
      width: 12,
      height: 12,
      viewBox: "0 0 12 12",
      fill: "none",
      "aria-hidden": true,
    },
    React.createElement("path", {
      d: "M3 3L9 9M9 3L3 9",
      stroke: "currentColor",
      strokeWidth: 1.5,
      strokeLinecap: "round",
    }),
  );
}
function IconScope() {
  return React.createElement(
    "svg",
    {
      width: 14,
      height: 14,
      viewBox: "0 0 16 16",
      fill: "none",
      "aria-hidden": true,
    },
    React.createElement("path", {
      d: "M8 1.5L14.5 4V8.5C14.5 12 11.6 14.2 8 15C4.4 14.2 1.5 12 1.5 8.5V4L8 1.5Z",
      stroke: "currentColor",
      strokeWidth: 1.2,
      strokeLinejoin: "round",
    }),
    React.createElement("path", {
      d: "M8 8.5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
      stroke: "currentColor",
      strokeWidth: 1.1,
    }),
  );
}

// ---------- shared helpers ----------
function sepOf(path: string) {
  return path.indexOf("\\") !== -1 ? "\\" : "/";
}
function comparablePath(path: string) {
  return sepOf(path) === "\\" ? path.toLowerCase() : path;
}
// Whether `path` is `root` or lies beneath it (separator-aware prefix).
function isUnder(path: string, root: string) {
  const comparableTarget = comparablePath(path);
  const comparableRoot = comparablePath(root);
  if (comparableTarget === comparableRoot) return true;
  const sep = sepOf(root);
  const prefix = comparableRoot.endsWith(sep)
    ? comparableRoot
    : comparableRoot + sep;
  return comparableTarget.indexOf(prefix) === 0;
}
// The deepest selected root that covers `path`, or undefined.
function coveringRoot(path: string, roots: any[]) {
  let best: string | undefined;
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    if (
      isUnder(path, root) &&
      (best === undefined || root.length > best.length)
    )
      best = root;
  }
  return best;
}
function baseName(path: string) {
  const sep = sepOf(path);
  const parts = path.split(sep).filter(Boolean);
  return parts.length === 0 ? path : parts[parts.length - 1];
}
// Render paths relative to the session workspace. Absolute paths remain
// host-side implementation details and never need to appear in the picker.
function displayPath(path: string, root: string) {
  if (
    typeof path !== "string" ||
    typeof root !== "string" ||
    !isUnder(path, root)
  )
    return baseName(path);
  if (comparablePath(path) === comparablePath(root)) return ".";
  let relative = path.slice(root.length);
  const sep = sepOf(root);
  while (relative.startsWith(sep)) relative = relative.slice(1);
  return relative.split(sep).join("/");
}
function normalizeDraftRoots(roots: any) {
  return Array.isArray(roots)
    ? roots.filter(function (root: string) {
        return typeof root === "string";
      })
    : [];
}
function comparableScopeRoots(roots: any) {
  const ordered = normalizeDraftRoots(roots)
    .slice()
    .sort(function (left, right) {
      return (
        left.length - right.length ||
        comparablePath(left).localeCompare(comparablePath(right))
      );
    });
  const collapsed: string[] = [];
  for (let i = 0; i < ordered.length; i++) {
    if (
      !collapsed.some(function (root) {
        return isUnder(ordered[i], root);
      })
    )
      collapsed.push(ordered[i]);
  }
  return collapsed.sort(function (left, right) {
    return comparablePath(left).localeCompare(comparablePath(right));
  });
}
function sameRoots(left: any, right: any) {
  const a = comparableScopeRoots(left);
  const b = comparableScopeRoots(right);
  return (
    a.length === b.length &&
    a.every(function (root, index) {
      return comparablePath(root) === comparablePath(b[index]);
    })
  );
}

const stringSchema = {
  parse: function (value: any) {
    if (typeof value !== "string" || value.length === 0)
      throw new TypeError("expected a non-empty string");
    return value;
  },
};
const directoryListingSchema = {
  parse: function (value: any) {
    if (value === null || typeof value !== "object")
      throw new TypeError("expected a directory listing");
    if (typeof value.path !== "string" || typeof value.home !== "string")
      throw new TypeError("invalid directory listing roots");
    if (!Array.isArray(value.crumbs) || !Array.isArray(value.entries))
      throw new TypeError("invalid directory listing rows");
    return {
      path: value.path,
      home: value.home,
      crumbs: value.crumbs.map(function (crumb: any) {
        if (
          crumb === null ||
          typeof crumb !== "object" ||
          typeof crumb.name !== "string" ||
          typeof crumb.path !== "string"
        ) {
          throw new TypeError("invalid directory crumb");
        }
        return { name: crumb.name, path: crumb.path };
      }),
      entries: value.entries.map(function (entry: any) {
        if (
          entry === null ||
          typeof entry !== "object" ||
          typeof entry.name !== "string" ||
          typeof entry.path !== "string"
        ) {
          throw new TypeError("invalid directory entry");
        }
        return {
          name: entry.name,
          path: entry.path,
          hidden: entry.hidden === true,
        };
      }),
      truncated: value.truncated === true,
    };
  },
};
const scopeRemoteContribution = {
  package: "@yadsh/dsh-session-scope",
  descriptors: [
    {
      id: "@yadsh/dsh-session-scope#sessionScope/list",
      service: "sessionScopeRead",
      namespace: "sessionScope",
      method: "list",
      invocation: { kind: "direct" },
      parameters: [
        {
          name: "sessionId",
          wire: "sessionId",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "SessionId",
            schema: stringSchema,
          },
        },
        {
          name: "path",
          wire: "path",
          source: "json",
          codec: {
            mode: "strict",
            typeSymbol: "string",
            schema: stringSchema,
          },
        },
      ],
      result: {
        mode: "strict",
        typeSymbol: "DirectoryListing",
        schema: directoryListingSchema,
      },
    },
  ],
};

function apply(ctx: any): () => void {
  let styleTag: any = null;
  try {
    styleTag = document.createElement("style");
    styleTag.textContent = CSS;
    document.head.appendChild(styleTag);
  } catch {
    /* styling is cosmetic */
  }

  function remote() {
    const value = ctx.get("remote");
    return value !== undefined && value !== null ? value : undefined;
  }
  let scopeRemoteDispose: any = null;
  let scopeRemoteError: any = null;
  let scopeRemoteFace: any = null;
  const rem = remote();
  const scopeRemoteReady =
    rem !== undefined && typeof rem.$mount === "function"
      ? rem
          .$mount(scopeRemoteContribution)
          .then(function (dispose: any) {
            scopeRemoteDispose = dispose;
            if (typeof ctx.inject !== "function")
              throw new Error("session-scope: client injection unavailable");
            return ctx.inject(
              ["remote.sessionScope"],
              function (remoteCtx: any) {
                const injectedRemote = remoteCtx.get("remote");
                scopeRemoteFace = injectedRemote.sessionScope;
              },
            );
          })
          .catch(function (err: any) {
            scopeRemoteError = err instanceof Error ? err.message : String(err);
          })
      : Promise.resolve().then(function () {
          scopeRemoteError = "session-scope: Remote gateway unavailable";
        });

  // Execute one slash-command and return { ok, result } where result is
  // the normalized { kind, text } command result when the host answered.
  async function runCommand(sessionId: string, line: string) {
    const rem = remote();
    if (
      rem === undefined ||
      typeof rem.commands === "undefined" ||
      typeof rem.commands.execute !== "function"
    ) {
      return { ok: false, error: "remote command service unavailable" };
    }
    try {
      // commands/execute carries an image list even when the command is
      // text-only. Current DSH validates the generated remote arity.
      const response = await rem.commands.execute(sessionId, line, []);
      if (response === undefined || response === null || response.ok !== true) {
        const message =
          response !== undefined &&
          response !== null &&
          response.error !== undefined &&
          response.error.message !== undefined
            ? response.error.message
            : "command failed";
        return { ok: false, error: message };
      }
      const result =
        response.value !== undefined && response.value !== null
          ? response.value.result
          : undefined;
      if (result === undefined || result.kind !== "success") {
        return {
          ok: false,
          error:
            result !== undefined && result.text !== undefined
              ? result.text
              : "command failed",
        };
      }
      return { ok: true, result: result };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // List one directory level through the dedicated host RPC.
  async function listLevel(sessionId: string, path: string) {
    await scopeRemoteReady;
    if (scopeRemoteError !== null)
      return { ok: false, error: scopeRemoteError };
    if (
      scopeRemoteFace === null ||
      typeof scopeRemoteFace.list !== "function"
    ) {
      return { ok: false, error: "session-scope: read RPC unavailable" };
    }
    try {
      const response = await scopeRemoteFace.list(sessionId, path);
      if (response !== undefined && response.ok === true) {
        return { ok: true, value: response.value, source: "scope-rpc" };
      }
      const message =
        response !== undefined &&
        response.error !== undefined &&
        response.error.message !== undefined
          ? response.error.message
          : "session-scope: directory listing failed";
      return { ok: false, error: message };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------- the scope editor (modal with the directory tree) ----------
  function ScopeEditor(props: any) {
    // props: sessionId, workspaceRoot (injected cwd, may be undefined),
    // projectedRoot, scopeMode, scopeRoots, capabilities, onClose
    const state = React.useState<any>({
      root: null,
      rootSource: null, // 'injected' | 'projection'
      path: null,
      listing: null, // { path, crumbs, entries, truncated }
      loading: false,
      saving: false,
      error: null,
      phase: L("正在解析工作区…", "Resolving workspace…"),
      retryToken: 0,
      isolatedSupported:
        props.capabilities !== undefined
          ? props.capabilities.isolated === true
          : null,
      mode:
        props.scopeMode === "focused" || props.scopeMode === "isolated"
          ? props.scopeMode
          : "full",
      // Local pending content roots. In full mode the workspace root is
      // inserted after root resolution to keep the checkbox semantics.
      draft: normalizeDraftRoots(props.scopeRoots),
    });
    const snap = state[0];
    const setSnap = state[1];
    const patch = function (part: any) {
      setSnap(function (prev: any) {
        return Object.assign({}, prev, part);
      });
    };

    // Resolve the immutable workspace root from the session list or the
    // session-scope projection. No read command is issued from the UI.
    function applyRoot(root: string, source: string, mode: string, roots: any) {
      const nextMode =
        mode === "focused" || mode === "isolated" ? mode : "full";
      patch({
        root: root,
        rootSource: source,
        phase: L("正在加载目录…", "Loading directories…"),
        error: null,
        mode: nextMode,
        draft: nextMode === "full" ? [root] : normalizeDraftRoots(roots),
      });
    }
    React.useEffect(
      function () {
        let cancelled = false;
        const timer: any = null;
        (async function () {
          try {
            if (snap.root !== null) return;
            const injected = props.workspaceRoot;
            if (
              injected !== undefined &&
              injected !== null &&
              injected !== ""
            ) {
              applyRoot(injected, "injected", snap.mode, snap.draft);
              return;
            }
            const projected = props.projectedRoot;
            if (
              projected !== undefined &&
              projected !== null &&
              projected !== ""
            ) {
              applyRoot(projected, "projection", snap.mode, snap.draft);
              return;
            }
            patch({
              loading: false,
              error: L(
                "无法解析工作区根目录",
                "could not resolve the workspace root",
              ),
              phase: null,
            });
          } catch (err) {
            if (cancelled) return;
            patch({
              loading: false,
              error:
                L("解析工作区失败：", "failed to resolve the workspace: ") +
                (err instanceof Error ? err.message : String(err)),
              phase: null,
            });
          }
        })();
        return function () {
          cancelled = true;
          if (timer !== null) clearTimeout(timer);
        };
      },
      [snap.root, snap.retryToken, props.workspaceRoot, props.projectedRoot],
    );

    // Load the first level when the root is known.
    React.useEffect(
      function () {
        let cancelled = false;
        let timer: any = null;
        if (snap.root === null || snap.path !== null) return;
        (async function () {
          patch({
            loading: true,
            error: null,
            phase: L("正在加载目录…", "Loading directories…"),
          });
          timer = setTimeout(function () {
            if (cancelled || snap.path !== null) return;
            patch({
              loading: false,
              error: L(
                "加载目录超时 — 请重试",
                "loading the directory timed out — please retry",
              ),
              phase: null,
            });
          }, 12000);
          const outcome = await listLevel(props.sessionId, snap.root);
          if (cancelled) return;
          if (timer !== null) {
            clearTimeout(timer);
            timer = null;
          }
          if (!outcome.ok) {
            patch({ loading: false, error: outcome.error, phase: null });
            return;
          }
          patch({
            loading: false,
            path: outcome.value.path,
            listing: outcome.value,
            source: outcome.source,
            phase: null,
          });
        })();
        return function () {
          cancelled = true;
          if (timer !== null) clearTimeout(timer);
        };
      },
      [snap.root, snap.path],
    );

    // Retry from scratch after a failure.
    function retry() {
      patch({
        root: null,
        path: null,
        listing: null,
        loading: false,
        error: null,
        phase: L("正在解析工作区…", "Resolving workspace…"),
        retryToken: snap.retryToken + 1,
      });
    }

    // Navigate into a directory.
    function enter(path: string) {
      patch({
        loading: true,
        error: null,
        phase: L("正在加载目录…", "Loading directories…"),
      });
      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        patch({
          loading: false,
          error: L(
            "加载目录超时 — 请重试",
            "loading the directory timed out — please retry",
          ),
          phase: null,
        });
      }, 12000);
      listLevel(props.sessionId, path).then(
        function (outcome) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!outcome.ok) {
            patch({ loading: false, error: outcome.error, phase: null });
            return;
          }
          patch({
            loading: false,
            path: outcome.value.path,
            listing: outcome.value,
            source: outcome.source,
            phase: null,
          });
        },
        function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          console.error("[session-scope] directory listing failed:", err);
          patch({
            loading: false,
            error:
              L("加载目录失败：", "failed to load the directory: ") +
              (err instanceof Error ? err.message : String(err)),
            phase: null,
          });
        },
      );
    }

    // Persist the whole pending draft. Called once from the Done button,
    // never per toggle. The RPC must not leave the modal stuck: a timeout
    // and a rejection handler both settle the flag and surface a visible
    // error, keeping the modal open with the draft intact.
    function save(mode: string, draft: string[]) {
      const effectiveMode =
        snap.root !== null && draft.indexOf(snap.root) !== -1 ? "full" : mode;
      const effectiveRoots =
        effectiveMode === "full" ? [] : normalizeDraftRoots(draft);
      const currentRoots = normalizeDraftRoots(props.scopeRoots);
      if (
        effectiveMode === props.scopeMode &&
        sameRoots(effectiveRoots, currentRoots)
      ) {
        props.onClose();
        return;
      }
      patch({ saving: true, error: null });
      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        patch({
          saving: false,
          error: L("保存超时 — 请重试", "saving timed out — please retry"),
        });
      }, 12000);
      const command =
        effectiveMode === "full"
          ? "/scope full"
          : "/scope " + effectiveMode + " " + JSON.stringify(draft);
      runCommand(props.sessionId, command).then(
        function (outcome) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!outcome.ok) {
            patch({ saving: false, error: outcome.error });
            return;
          }
          patch({ saving: false });
          props.onClose();
        },
        function (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const message = err instanceof Error ? err.message : String(err);
          console.error("[session-scope] save command failed:", err);
          patch({
            saving: false,
            error: L("保存失败：", "save failed: ") + message,
          });
        },
      );
    }

    // Toggle one directory in the LOCAL draft (no RPC yet — the draft is
    // persisted on Done). The workspace root is an ordinary member: it is
    // toggled exactly like every other row, so the checked state always
    // matches the visible content roots. A row that is only COVERED by a selected
    // ancestor is not toggleable here — uncheck the ancestor (its row
    // shows the covering check) to stop including the whole subtree.
    function toggle(path: string) {
      const self = snap.draft.indexOf(path);
      let next;
      if (self !== -1) {
        next = snap.draft.filter(function (root: string) {
          return root !== path;
        });
      } else {
        next = snap.draft.concat([path]);
      }
      if (snap.root !== null && path === snap.root) {
        patch({
          mode:
            self === -1
              ? "full"
              : snap.mode === "isolated"
                ? "isolated"
                : "focused",
          draft: self === -1 ? [snap.root] : next,
          error: null,
        });
        return;
      }
      patch({ draft: next, error: null });
    }

    function selectMode(mode: string) {
      if (mode === "isolated" && snap.isolatedSupported === false) {
        patch({
          error: L(
            "隔离模式需要支持 bubblewrap 的 Linux 主机。此主机仍可使用聚焦模式。",
            "Isolated mode requires a Linux host with supported bubblewrap. Focused mode remains available on this host.",
          ),
        });
        return;
      }
      if (mode === "full") {
        patch({
          mode: "full",
          draft: snap.root === null ? [] : [snap.root],
          error: null,
        });
        return;
      }
      patch({
        mode: mode,
        draft:
          snap.root === null
            ? snap.draft
            : snap.draft.filter(function (root: string) {
                return root !== snap.root;
              }),
        error: null,
      });
    }

    // Escape / outside-click closes the modal.
    const modalRef = React.useRef<any>(null);
    React.useEffect(function () {
      function onDown(ev: any) {
        if (
          modalRef.current !== null &&
          ev.target instanceof Node &&
          modalRef.current.contains(ev.target)
        )
          return;
        props.onClose();
      }
      function onKey(ev: any) {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        props.onClose();
      }
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey, true);
      return function () {
        document.removeEventListener("pointerdown", onDown, true);
        document.removeEventListener("keydown", onKey, true);
      };
    }, []);

    const listing = snap.listing;
    const crumbs = listing !== null ? listing.crumbs : [];
    const entries = listing !== null ? listing.entries : [];
    const visibleCrumbs =
      snap.root === null
        ? []
        : crumbs.filter(function (crumb: any) {
            return isUnder(crumb.path, snap.root);
          });
    const overlay = React.createElement(
      "div",
      { className: "wss-overlay" },
      React.createElement(
        "div",
        {
          className: "wss-modal",
          ref: modalRef,
          role: "dialog",
          "aria-label": L("会话范围", "Session scope"),
        },
        React.createElement(
          "div",
          { className: "wss-head" },
          React.createElement(
            "span",
            { className: "wss-title" },
            L("会话范围", "Session Scope"),
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "wss-close",
              onClick: props.onClose,
              "aria-label": L("关闭", "Close"),
            },
            IconClose(),
          ),
        ),
        React.createElement(
          "div",
          { className: "wss-caption" },
          L(
            "范围控制 agent 可以看到的工作区部分，与读写权限无关。Focused 限制 DSH 文件工具；Isolated 还限制受支持的 shell 进程。",
            "Scope controls which workspace areas the agent can see, independently from read/write permission. Focused restricts DSH filesystem tools; Isolated also confines supported shell processes.",
          ),
        ),
        React.createElement(
          "div",
          {
            className: "wss-modes",
            role: "radiogroup",
            "aria-label": L("范围模式", "Scope mode"),
          },
          [
            { value: "full", label: L("整个工作区", "Entire workspace") },
            { value: "focused", label: L("聚焦", "Focused") },
            { value: "isolated", label: L("隔离", "Isolated") },
          ].map(function (option) {
            const unavailable =
              option.value === "isolated" && snap.isolatedSupported === false;
            return React.createElement(
              "button",
              {
                key: option.value,
                type: "button",
                role: "radio",
                "aria-checked": snap.mode === option.value,
                className:
                  "wss-mode" +
                  (snap.mode === option.value ? " wss-modeOn" : "") +
                  (unavailable ? " wss-modeUnavailable" : ""),
                disabled: snap.saving,
                "aria-disabled": unavailable,
                title: unavailable
                  ? L(
                      "需要支持 bubblewrap 的 Linux 主机",
                      "Requires a Linux host with supported bubblewrap",
                    )
                  : option.label,
                onClick: function () {
                  selectMode(option.value);
                },
              },
              option.label,
            );
          }),
        ),
        snap.phase !== null &&
          React.createElement("div", { className: "wss-busy" }, snap.phase),
        snap.error !== null &&
          React.createElement(
            "div",
            { className: "wss-error" },
            snap.error,
            React.createElement(
              "button",
              {
                type: "button",
                className: "wss-btn wss-btnGhost",
                onClick: retry,
                style: { marginLeft: 8 },
              },
              L("重试", "Retry"),
            ),
          ),
        snap.root !== null &&
          React.createElement(
            "div",
            { className: "wss-crumbs" },
            visibleCrumbs.map(function (crumb: any, index: number) {
              return React.createElement(
                React.Fragment,
                { key: crumb.path },
                index > 0 &&
                  React.createElement(
                    "span",
                    { className: "wss-crumbSep" },
                    "/",
                  ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "wss-crumb",
                    title: displayPath(crumb.path, snap.root),
                    onClick: function () {
                      if (crumb.path !== snap.path) enter(crumb.path);
                    },
                  },
                  index === 0 ? "." : crumb.name,
                ),
              );
            }),
          ),
        React.createElement(
          "div",
          { className: "wss-tree" },
          snap.loading &&
            React.createElement(
              "div",
              { className: "wss-busy" },
              L("加载中…", "Loading…"),
            ),
          !snap.loading &&
            snap.path !== null &&
            React.createElement(
              "div",
              { className: "wss-row" },
              React.createElement(
                "button",
                {
                  type: "button",
                  className:
                    "wss-check" +
                    (coveringRoot(snap.path, snap.draft) !== undefined
                      ? " wss-checkOn"
                      : ""),
                  disabled:
                    snap.saving ||
                    (coveringRoot(snap.path, snap.draft) !== undefined &&
                      snap.draft.indexOf(snap.path) === -1),
                  "aria-label":
                    L("切换目录", "Toggle directory") +
                    " " +
                    displayPath(snap.path, snap.root),
                  title:
                    coveringRoot(snap.path, snap.draft) !== undefined &&
                    snap.draft.indexOf(snap.path) === -1
                      ? L(
                          "经父目录包含：取消父目录后整个子树将不可见",
                          "Included via a parent directory; uncheck the parent to hide its whole subtree",
                        )
                      : snap.path === snap.root
                        ? snap.draft.indexOf(snap.path) !== -1
                          ? L(
                              "整个工作区可见 — 取消勾选后选择聚焦范围",
                              "The entire workspace is visible — uncheck to choose a focused scope",
                            )
                          : L(
                              "勾选以显示整个工作区",
                              "Check to expose the entire workspace",
                            )
                        : displayPath(snap.path, snap.root),
                  onClick: function (ev: any) {
                    ev.stopPropagation();
                    toggle(snap.path);
                  },
                },
                coveringRoot(snap.path, snap.draft) !== undefined
                  ? IconCheck()
                  : null,
              ),
              React.createElement(
                "span",
                { className: "wss-rowName" },
                IconFolder(),
                React.createElement(
                  "span",
                  {
                    style: {
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                  },
                  displayPath(snap.path, snap.root),
                ),
              ),
              coveringRoot(snap.path, snap.draft) !== undefined &&
                snap.draft.indexOf(snap.path) === -1 &&
                React.createElement(
                  "span",
                  { className: "wss-hint" },
                  L("经父目录包含", "via parent"),
                ),
              snap.path === snap.root &&
                coveringRoot(snap.path, snap.draft) === undefined &&
                React.createElement(
                  "span",
                  { className: "wss-hint" },
                  L("聚焦范围", "focused scope"),
                ),
            ),
          !snap.loading &&
            snap.path !== null &&
            entries.map(function (entry: any) {
              const covered = coveringRoot(entry.path, snap.draft);
              const self = snap.draft.indexOf(entry.path) !== -1;
              const on = covered !== undefined;
              return React.createElement(
                "div",
                {
                  key: entry.path,
                  className: "wss-row",
                  onClick: function () {
                    enter(entry.path);
                  },
                },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "wss-check" + (on ? " wss-checkOn" : ""),
                    disabled: snap.saving || (on && !self),
                    "aria-label":
                      L("切换目录", "Toggle directory") +
                      " " +
                      displayPath(entry.path, snap.root),
                    title:
                      on && !self
                        ? L(
                            "经父目录包含：取消父目录后整个子树将不可见",
                            "Included via a parent directory; uncheck the parent to hide its whole subtree",
                          )
                        : displayPath(entry.path, snap.root),
                    onClick: function (ev: any) {
                      ev.stopPropagation();
                      toggle(entry.path);
                    },
                  },
                  on ? IconCheck() : null,
                ),
                React.createElement(
                  "span",
                  {
                    className:
                      "wss-rowName" + (entry.hidden ? " wss-rowNameDim" : ""),
                  },
                  IconFolder(),
                  React.createElement(
                    "span",
                    {
                      style: {
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      },
                    },
                    entry.name,
                  ),
                ),
                on &&
                  !self &&
                  React.createElement(
                    "span",
                    { className: "wss-hint" },
                    L("经父目录", "via parent"),
                  ),
                React.createElement(
                  "span",
                  { className: "wss-chevron" },
                  IconChevron(),
                ),
              );
            }),
          !snap.loading &&
            snap.path !== null &&
            entries.length === 0 &&
            React.createElement(
              "div",
              { className: "wss-empty" },
              L("（无子目录）", "(no subdirectories)"),
            ),
        ),
        React.createElement(
          "div",
          { className: "wss-foot" },
          React.createElement(
            "span",
            {
              className: "wss-footRoots",
              title: snap.draft
                .map(function (root: string) {
                  return displayPath(root, snap.root);
                })
                .join("\n"),
            },
            (snap.mode === "full"
              ? L("整个工作区 · ", "entire workspace · ")
              : snap.mode === "isolated"
                ? L("隔离 · ", "isolated · ")
                : L("聚焦 · ", "focused · ")) +
              (snap.draft.length === 0
                ? L("未选择目录", "no directories selected")
                : L(
                    "已选择 " + snap.draft.length + " 个目录",
                    String(snap.draft.length) +
                      " director" +
                      (snap.draft.length === 1 ? "y" : "ies") +
                      " selected",
                  )),
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "wss-btn wss-btnDanger",
              disabled: snap.saving || snap.draft.length === 0,
              onClick: function () {
                patch({ mode: "focused", draft: [], error: null });
              },
            },
            L("清除全部", "Clear all"),
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "wss-btn wss-btnPrimary",
              disabled: snap.saving,
              onClick: function () {
                save(snap.mode, snap.draft);
              },
            },
            L("应用", "Apply"),
          ),
        ),
        snap.saving &&
          React.createElement(
            "div",
            { className: "wss-busy" },
            L("保存中…", "Saving…"),
          ),
      ),
    );
    // The composer seat is sticky inside its own stacking context, so the
    // editor is portaled to document.body with a high z-index.
    return ReactDOM.createPortal(overlay, document.body);
  }

  // ---------- independent Scope chip ----------
  function ScopeButton(props: any) {
    // props: useProjection, sessionId, workspaceRoot (injected)
    const scope = props.useProjection("session-scope");
    const openState = React.useState(false);
    const open = openState[0];
    const setOpen = openState[1];
    const heroMountState = React.useState<any>(null);
    const heroMount = heroMountState[0];
    const setHeroMount = heroMountState[1];
    const heroCheckedState = React.useState(false);
    const heroChecked = heroCheckedState[0];
    const setHeroChecked = heroCheckedState[1];
    const heroProbe = React.useRef<any>(null);
    const blank =
      props.session !== undefined && props.session.composerPhase === "blank";
    React.useLayoutEffect(
      function () {
        if (!blank) {
          if (heroMount !== null) setHeroMount(null);
          if (heroChecked) setHeroChecked(false);
          return undefined;
        }
        const probe = heroProbe.current;
        const heroRoot =
          probe !== null && typeof probe.closest === "function"
            ? probe.closest('[data-phase="hero"]')
            : null;
        // Workspace is the first menu trigger in the hero tree. This uses
        // semantic DOM already exposed by DSH, not localized copy or its
        // generated CSS-module class names.
        const workspaceButton =
          heroRoot !== null && typeof heroRoot.querySelector === "function"
            ? heroRoot.querySelector('button[aria-haspopup="menu"]')
            : null;
        const row =
          workspaceButton !== null ? workspaceButton.parentNode : null;
        if (row === null || typeof row.insertBefore !== "function") {
          setHeroChecked(true);
          return undefined;
        }
        const mount = document.createElement("span");
        mount.className = "wss-heroMount";
        mount.setAttribute("data-session-scope-hero-mount", "");
        row.insertBefore(mount, workspaceButton.nextSibling);
        setHeroMount(mount);
        setHeroChecked(true);
        return function () {
          if (mount.parentNode !== null) mount.parentNode.removeChild(mount);
        };
      },
      [blank],
    );
    const roots =
      scope !== undefined && Array.isArray(scope.roots) ? scope.roots : [];
    const projectedRoot =
      scope !== undefined &&
      typeof scope.workspaceRoot === "string" &&
      scope.workspaceRoot !== ""
        ? scope.workspaceRoot
        : undefined;
    const mode =
      scope !== undefined &&
      (scope.mode === "focused" || scope.mode === "isolated")
        ? scope.mode
        : "full";
    const capabilities =
      scope !== undefined && scope.capabilities !== undefined
        ? scope.capabilities
        : undefined;
    const label =
      mode === "full"
        ? L("范围：全部", "Scope: All")
        : roots.length === 0
          ? L("范围：无", "Scope: None")
          : roots.length === 1
            ? L("范围：", "Scope: ") + baseName(roots[0])
            : L(
                "范围：" + String(roots.length) + " 个目录",
                "Scope: " + String(roots.length) + " roots",
              );
    const title =
      mode === "isolated"
        ? L("隔离会话范围", "Isolated session scope")
        : mode === "focused"
          ? L("聚焦会话范围", "Focused session scope")
          : L("整个工作区可见", "Entire workspace visible");
    const button = React.createElement(
      "button",
      {
        type: "button",
        className:
          blank && heroMount !== null
            ? "wss-btnScope wss-btnScopeHero"
            : "wss-btnScope",
        "data-session-scope-button": true,
        "aria-haspopup": "dialog",
        "aria-expanded": open,
        "aria-label": label,
        title: title,
        onClick: function () {
          setOpen(true);
        },
      },
      React.createElement(
        "span",
        { style: { display: "inline-flex" } },
        IconScope(),
      ),
      label,
      React.createElement("span", { className: "wss-chevron" }, IconChevron()),
    );
    return React.createElement(
      React.Fragment,
      null,
      blank &&
        React.createElement("span", {
          ref: heroProbe,
          className: "wss-heroProbe",
          "aria-hidden": true,
        }),
      blank && heroMount !== null
        ? ReactDOM.createPortal(button, heroMount)
        : (!blank || heroChecked) && button,
      open &&
        React.createElement(ScopeEditor, {
          sessionId: props.sessionId,
          workspaceRoot: props.workspaceRoot,
          projectedRoot: projectedRoot,
          scopeMode: mode,
          scopeRoots: roots,
          capabilities: capabilities,
          onClose: function () {
            setOpen(false);
          },
        }),
    );
  }

  // ---------- registration ----------
  const disposers: any[] = [];
  const slots = ctx.get("slots");
  if (slots !== undefined) {
    function scopeInjection(sessionId: string) {
      // The session's workspace root never changes; the sessions list
      // store (byId, keyed by session id) is the cheapest reliable
      // source. The editor falls back to the session-scope projection.
      let root = undefined;
      try {
        const sessions = ctx.get("sessions");
        if (
          sessions !== undefined &&
          sessions.list !== undefined &&
          typeof sessions.list.getSnapshot === "function"
        ) {
          const snapshot = sessions.list.getSnapshot();
          const entry =
            snapshot.byId !== undefined ? snapshot.byId[sessionId] : undefined;
          if (entry !== undefined && entry.cwd !== undefined) root = entry.cwd;
        }
      } catch {
        /* non-fatal: the editor resolves the root itself */
      }
      return { workspaceRoot: root };
    }
    // This existing session-scoped seat supplies both the ordinary
    // composer control and the lifecycle anchor for its blank-session
    // hero portal.
    disposers.push(
      ctx.effect(function () {
        return slots.inject("conversation.input.left", function () {
          return slots.register(
            {
              name: "conversation.input.left",
              id: "session-scope",
              order: 0,
              inject: function (sessionId: string) {
                return scopeInjection(sessionId);
              },
            },
            ScopeButton,
          );
        });
      }),
    );
  }

  return function () {
    for (let i = 0; i < disposers.length; i++) {
      try {
        disposers[i]();
      } catch {
        /* best effort */
      }
    }
    if (scopeRemoteDispose !== null) {
      try {
        void scopeRemoteDispose();
      } catch {
        /* best effort */
      }
    }
    if (styleTag !== null && styleTag.parentNode !== null)
      styleTag.parentNode.removeChild(styleTag);
  };
}

export const inject = ["slots", "remote", "remote.commands", "sessions"];

export { apply };
