// dsh-session-scope — the scope editor (modal with the directory tree).
//
// The editor owns the pending draft: it resolves the immutable workspace root
// the host already injected, walks one directory level at a time through the
// plugin's read RPC, and holds the checked set locally until Done persists the
// whole draft as one `/scope` command. Nothing here writes per toggle, and every
// read is bounded by a visible timeout so a host that stops answering leaves the
// modal retryable instead of stuck.
import * as React from "react";
import * as ReactDOM from "react-dom";

import { L } from "./copy.js";
import { normalizeDraftRoots, sameRoots } from "./paths.js";
import { ScopeEditorView } from "./scope-editor-view.js";

export function ScopeEditor(props: any) {
  // props: sessionId, workspaceRoot (injected cwd, may be undefined),
  // projectedRoot, scopeMode, scopeRoots, capabilities, onClose,
  // runCommand, listLevel
  // The transport belongs to the plugin instance that mounts the editor (see
  // `index.ts`); the editor only ever sees the two calls it makes.
  const runCommand: (sessionId: string, line: string) => Promise<any> =
    props.runCommand;
  const listLevel: (sessionId: string, path: string) => Promise<any> =
    props.listLevel;
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
    const nextMode = mode === "focused" || mode === "isolated" ? mode : "full";
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
          if (injected !== undefined && injected !== null && injected !== "") {
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

  // Clear every pending row without leaving the editor. The mode stays
  // focused, so an Apply right after this sends an empty scope rather than
  // re-exposing the whole workspace.
  function clearAll() {
    patch({ mode: "focused", draft: [], error: null });
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

  // The composer seat is sticky inside its own stacking context, so the
  // editor is portaled to document.body with a high z-index.
  return ReactDOM.createPortal(
    React.createElement(ScopeEditorView, {
      snap: snap,
      modalRef: modalRef,
      onClose: props.onClose,
      retry: retry,
      enter: enter,
      save: save,
      toggle: toggle,
      selectMode: selectMode,
      clearAll: clearAll,
    }),
    document.body,
  );
}
