// dsh-session-scope — client path helpers.
//
// The editor compares host-side filesystem paths, so every rule the picker
// needs is here and separator-aware: Windows paths are case-insensitive and
// use `\`, POSIX paths are not, and a row is only ever rendered relative to the
// session workspace it lives under.
function sepOf(path: string) {
  return path.indexOf("\\") !== -1 ? "\\" : "/";
}
function comparablePath(path: string) {
  return sepOf(path) === "\\" ? path.toLowerCase() : path;
}
// Whether `path` is `root` or lies beneath it (separator-aware prefix).
export function isUnder(path: string, root: string) {
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
export function coveringRoot(path: string, roots: any[]) {
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
export function baseName(path: string) {
  const sep = sepOf(path);
  const parts = path.split(sep).filter(Boolean);
  return parts.length === 0 ? path : parts[parts.length - 1];
}
// Render paths relative to the session workspace. Absolute paths remain
// host-side implementation details and never need to appear in the picker.
export function displayPath(path: string, root: string) {
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
export function normalizeDraftRoots(roots: any) {
  return Array.isArray(roots)
    ? roots.filter(function (root: string) {
        return typeof root === "string";
      })
    : [];
}
export function comparableScopeRoots(roots: any) {
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
export function sameRoots(left: any, right: any) {
  const a = comparableScopeRoots(left);
  const b = comparableScopeRoots(right);
  return (
    a.length === b.length &&
    a.every(function (root, index) {
      return comparablePath(root) === comparablePath(b[index]);
    })
  );
}
