const REPAIR_UI_SELECTOR = "[data-dsh-ui-repair-ui]";

export const DEFAULT_ROOT_SELECTOR = [
  "[data-dsh-ui-repair-root]",
  "[data-dsh-plugin-root]",
  "[data-plugin-root]",
  "[data-slot='settings.plugin.item'] > *",
  "[role='dialog'][aria-modal='true']",
].join(",");

function isElement(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    value.nodeType === 1
  );
}

export function matches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

export function queryAll(
  root: ParentNode,
  selector: string,
): readonly Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

export function collectRoots(
  source: ParentNode,
  selector: string,
): readonly HTMLElement[] {
  const roots = new Set<HTMLElement>();
  if (isElement(source)) {
    if (matches(source, selector)) roots.add(source as HTMLElement);
    try {
      const owner = source.closest(selector);
      if (owner !== null) roots.add(owner as HTMLElement);
    } catch {}
  }
  for (const element of queryAll(source, selector)) {
    if (!matches(element, REPAIR_UI_SELECTOR)) roots.add(element as HTMLElement);
  }
  return Array.from(roots).filter(
    (root) => !matches(root, REPAIR_UI_SELECTOR),
  );
}

export function collectElements(
  root: HTMLElement,
  limit: number,
): readonly HTMLElement[] {
  const result: HTMLElement[] = [root];
  if (limit <= 1) return result;
  for (const element of queryAll(root, "*")) {
    if (result.length >= limit) break;
    if (matches(element, REPAIR_UI_SELECTOR)) continue;
    result.push(element as HTMLElement);
  }
  return result;
}

function stableAttribute(element: Element): string | undefined {
  for (const attribute of [
    "data-dsh-ui-repair-root",
    "data-dsh-plugin-root",
    "data-plugin-root",
    "data-plugin",
    "data-slot",
    "role",
  ]) {
    const value = element.getAttribute(attribute);
    if (value !== null) return `[${attribute}=${JSON.stringify(value)}]`;
  }
  return undefined;
}

export function describeElement(element: Element): string {
  if (element.id.length > 0) return `#${element.id}`;
  const attribute = stableAttribute(element);
  if (attribute !== undefined) return `${element.localName}${attribute}`;
  const classes = Array.from(element.classList)
    .filter((className) => !className.includes("__"))
    .slice(0, 2);
  return `${element.localName}${classes.map((item) => `.${item}`).join("")}`;
}

export function inferPlugin(root: HTMLElement): string | undefined {
  for (const attribute of [
    "data-dsh-plugin-root",
    "data-plugin-root",
    "data-plugin",
  ]) {
    const value = root.getAttribute(attribute)?.trim();
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
}

export function addTokenAttribute(
  element: HTMLElement,
  attribute: string,
  token: string,
): void {
  const tokens = new Set(
    (element.getAttribute(attribute) ?? "").split(/\s+/u).filter(Boolean),
  );
  tokens.add(token);
  element.setAttribute(attribute, Array.from(tokens).join(" "));
}

export function removeTokenAttribute(
  element: HTMLElement,
  attribute: string,
  token: string,
): void {
  const tokens = (element.getAttribute(attribute) ?? "")
    .split(/\s+/u)
    .filter((item) => item.length > 0 && item !== token);
  if (tokens.length === 0) element.removeAttribute(attribute);
  else element.setAttribute(attribute, tokens.join(" "));
}
