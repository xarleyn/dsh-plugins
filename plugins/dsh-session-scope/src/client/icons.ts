// dsh-session-scope — client icons.
//
// Inline SVG stroked with `currentColor` rather than font glyphs: a glyph's
// shape and baseline depend on the font the shell happens to load, while the
// chip and the tree rows must line up with the host's own controls.
import * as React from "react";

export function IconFolder() {
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
export function IconChevron() {
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
export function IconCheck() {
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
export function IconClose() {
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
export function IconScope() {
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
