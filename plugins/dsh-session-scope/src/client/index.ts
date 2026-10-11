// dsh-session-scope — web client half, composition root.
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
// What stays here is what only the plugin instance can own: the transport (the
// Remote mount, the durable `/scope` write, the read RPC), the seat the chip
// claims, and the teardown of everything mounted. The copy, the sheet, the
// icons, the path rules, the Remote contract and the editor itself are modules
// beside this one.
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

import { L } from "./copy.js";
import { IconChevron, IconScope } from "./icons.js";
import { baseName } from "./paths.js";
import { scopeRemoteContribution } from "./remote.js";
import { ScopeEditor } from "./scope-editor.js";

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
          runCommand: runCommand,
          listLevel: listLevel,
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
