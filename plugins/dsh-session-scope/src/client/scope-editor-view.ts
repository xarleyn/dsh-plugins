// dsh-session-scope — the scope editor view.
//
// Pure rendering of the draft: mode row, breadcrumb trail, the tree with one
// checkbox per directory, and the footer that says what is about to be sent. The
// state and the commands that mutate it live in `scope-editor.ts`; a row that is
// only COVERED by a selected ancestor reads as checked and disabled here,
// because unchecking the ancestor is the only way to hide that subtree.
import * as React from "react";

import { L } from "./copy.js";
import { IconCheck, IconChevron, IconClose, IconFolder } from "./icons.js";
import { coveringRoot, displayPath, isUnder } from "./paths.js";

export function ScopeEditorView(props: any) {
  const {
    snap,
    modalRef,
    onClose,
    retry,
    enter,
    save,
    toggle,
    selectMode,
    clearAll,
  } = props;
  const listing = snap.listing;
  const crumbs = listing !== null ? listing.crumbs : [];
  const entries = listing !== null ? listing.entries : [];
  const visibleCrumbs =
    snap.root === null
      ? []
      : crumbs.filter(function (crumb: any) {
          return isUnder(crumb.path, snap.root);
        });
  return React.createElement(
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
            onClick: onClose,
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
                React.createElement("span", { className: "wss-crumbSep" }, "/"),
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
              clearAll();
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
}
