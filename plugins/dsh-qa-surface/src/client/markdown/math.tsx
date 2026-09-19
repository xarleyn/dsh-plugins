/**
 * TeX-to-React via KaTeX, mirroring the Host transcript's math pipeline: the
 * same two-arm error chain (strict render, `strict: 'ignore'` retry, error
 * span) so a formula renders identically here and in DSH's own message. KaTeX
 * emits an HTML string; the browser's HTML parser turns it into a tree this
 * module maps onto React elements — the output is a static span/MathML/SVG
 * vocabulary with no raw author HTML, the same trust the fenced-code
 * highlighter's tree gets.
 *
 * React has no MathML support, so the `.katex-mathml` subtree's elements land
 * in the HTML namespace; the visual arm is the `.katex-html` span tree and
 * the MathML arm serves assistive technology, which reads it by tag name.
 */

import { createElement } from "react";
import type { CSSProperties, ReactNode } from "react";
import katex from "katex";

/** KaTeX's stock error color, matching the Host's rehype-katex pipeline. */
const ERROR_COLOR = "#cc0000";

/**
 * Convert one inline `style` attribute string into React's style object.
 * KaTeX emits only plain kebab-case declarations, so camel-casing the
 * property is the whole mapping.
 */
function styleObject(css: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const declaration of css.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    const key = name.replace(/-([a-z])/gu, (_, letter: string) =>
      letter.toUpperCase(),
    );
    style[key] = declaration.slice(colon + 1).trim();
  }
  return style;
}

/** Map one parsed DOM node onto a React element (text nodes pass through). */
function domToReact(node: ChildNode, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  const element = node as Element;
  const props: Record<string, unknown> = { key };
  for (const attribute of element.attributes) {
    if (attribute.name === "class") props.className = attribute.value;
    else if (attribute.name === "style")
      props.style = styleObject(attribute.value);
    else props[attribute.name] = attribute.value;
  }
  const children = [...element.childNodes].map((child, index) =>
    domToReact(child, index),
  );
  return children.length === 0
    ? createElement(element.localName, props)
    : createElement(element.localName, props, ...children);
}

/**
 * Render TeX source to React elements through KaTeX.
 * @param value - The TeX source (a math node's raw content).
 * @param displayMode - Display (block) versus inline rendering.
 * @returns KaTeX's element tree, or the error span when the source does not
 * parse even under `strict: 'ignore'`.
 */
export function renderTexToReact(
  value: string,
  displayMode: boolean,
): ReactNode {
  let html: string;
  try {
    html = katex.renderToString(value, { displayMode, throwOnError: true });
  } catch {
    try {
      html = katex.renderToString(value, {
        displayMode,
        strict: "ignore",
        throwOnError: false,
      });
    } catch {
      // KaTeX renders ParseErrors itself under throwOnError: false; only its
      // internal errors reach here, so mirror the manual error span.
      return (
        <span className="katex-error" style={{ color: ERROR_COLOR }}>
          {value}
        </span>
      );
    }
  }
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return [...parsed.body.childNodes].map((child, index) =>
    domToReact(child, index),
  );
}
