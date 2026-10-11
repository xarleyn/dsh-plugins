import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * The palette the surface paints with. The Host owns the same three
 * preferences and applies the one it stores; its settings surface is not
 * reachable from `/qa` — the overlay suppresses the native shell, and the
 * kiosk never mounts it — so the QA page carries its own choice.
 *
 * The choice is browser-local on purpose: it is written to this deployment's
 * localStorage namespace, never to the Host user-settings document, because a
 * stand is shared by everyone who opens it and one visitor's eyes are not a
 * deployment setting.
 */

/** The preferences the control offers — the same vocabulary the Host uses. */
export const QA_THEME_PREFERENCES = ["light", "dark", "system"] as const;

export type QaThemePreference = (typeof QA_THEME_PREFERENCES)[number];

/** Body attribute that selects the dark palette in the Host token sheet. */
export const QA_DARK_THEME_ATTRIBUTE = "data-ds-dark-theme";

function isQaThemePreference(value: unknown): value is QaThemePreference {
  return QA_THEME_PREFERENCES.some((preference) => preference === value);
}

/** `light`/`dark` are themselves; `system` is whatever the OS asks for. */
export function resolveQaThemeScheme(
  preference: QaThemePreference,
  systemDark: boolean,
): "light" | "dark" {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

/** The stored choice, or null when this browser never picked one. */
export function readQaThemePreference(
  storage: Pick<Storage, "getItem">,
  key: string,
): QaThemePreference | null {
  try {
    const raw = storage.getItem(key);
    return isQaThemePreference(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeQaThemePreference(
  storage: Pick<Storage, "setItem">,
  key: string,
  preference: QaThemePreference,
): void {
  try {
    storage.setItem(key, preference);
  } catch {
    // Denied durable storage only costs persistence across reloads.
  }
}

/**
 * What the control shows while this browser has no choice of its own: the
 * palette the document is already painted with, read through the Host's own
 * contract. The Host publishes its *preference* nowhere in the DOM — only the
 * resolved palette — so an untouched stand is reported as the palette it
 * shows, never as a preference this browser did not pick.
 */
export function readQaThemeScheme(
  target: Pick<QaThemeDocument, "body">,
): Exclude<QaThemePreference, "system"> {
  return target.body.hasAttribute(QA_DARK_THEME_ATTRIBUTE) ? "dark" : "light";
}

/** The two document nodes the palette hangs on, injectable for tests. */
export interface QaThemeDocument {
  readonly documentElement: {
    style: { colorScheme: string };
  };
  readonly body: {
    hasAttribute: (name: string) => boolean;
    setAttribute: (name: string, value: string) => void;
    removeAttribute: (name: string) => void;
  };
}

/**
 * Project one preference onto the document, writing exactly the two fields the
 * Host's own presenter owns for the same choice: the native-chrome scheme on
 * the root and the palette attribute on the body. Nothing else — the font-size
 * axis and the theme token overrides stay the Host's.
 */
export function applyQaThemePreference(
  target: QaThemeDocument,
  preference: QaThemePreference,
  systemDark: boolean,
): void {
  const scheme = resolveQaThemeScheme(preference, systemDark);
  target.documentElement.style.colorScheme = scheme;
  if (scheme === "dark") target.body.setAttribute(QA_DARK_THEME_ATTRIBUTE, "");
  else target.body.removeAttribute(QA_DARK_THEME_ATTRIBUTE);
}

function readSystemDarkScheme(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/** What the document is wearing before this browser's choice is painted over it. */
interface QaThemePaintState {
  readonly scheme: string;
  readonly dark: boolean;
}

function readQaThemePaintState(target: QaThemeDocument): QaThemePaintState {
  return {
    scheme: target.documentElement.style.colorScheme,
    dark: target.body.hasAttribute(QA_DARK_THEME_ATTRIBUTE),
  };
}

/**
 * Put one of these back verbatim. Unlike `applyQaThemePreference` it carries the
 * empty `color-scheme` a browser that never chose leaves behind, so restoring is
 * not the same as painting `light`.
 */
function writeQaThemePaintState(
  target: QaThemeDocument,
  state: QaThemePaintState,
): void {
  target.documentElement.style.colorScheme = state.scheme;
  if (state.dark) target.body.setAttribute(QA_DARK_THEME_ATTRIBUTE, "");
  else target.body.removeAttribute(QA_DARK_THEME_ATTRIBUTE);
}

/**
 * The painted palette as an external store. Reading it during the render would
 * report the palette the document wore the last time React rendered this
 * component, and nothing re-renders it when the Host repaints underneath; the
 * control would then name a theme the visitor is not looking at.
 */
function subscribeQaThemeScheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: [QA_DARK_THEME_ATTRIBUTE],
  });
  return () => {
    observer.disconnect();
  };
}

function getQaThemeSchemeSnapshot(): Exclude<QaThemePreference, "system"> {
  return readQaThemeScheme(document);
}

export interface QaThemePreferenceState {
  /** The choice this browser owns, or the palette it is looking at. */
  readonly preference: QaThemePreference;
  readonly select: (preference: QaThemePreference) => void;
}

export interface UseQaThemePreferenceOptions {
  /** Whether the surface is what the visitor is looking at right now. */
  readonly active: boolean;
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  readonly storageKey: string;
}

/**
 * Own the palette for as long as the surface is what the visitor sees, and only
 * for as long as this browser actually asked for one: an explicit choice is
 * written to storage and projected onto the document, `system` keeps answering
 * the OS, and a visitor who never touches the control leaves the Host's own
 * palette in force — the surface writes nothing at all in that case.
 */
export function useQaThemePreference({
  active,
  storage,
  storageKey,
}: UseQaThemePreferenceOptions): QaThemePreferenceState {
  const [stored, setStored] = useState<QaThemePreference | null>(() =>
    readQaThemePreference(storage, storageKey),
  );
  const [systemDark, setSystemDark] = useState(readSystemDarkScheme);

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      setSystemDark(query.matches);
    };
    onChange();
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    if (!active || stored === null) return;
    // The surface borrows the document rather than owning it: the palette it
    // finds here is the one the Host put on the page, and leaving `/qa` — the
    // route going inactive, or the overlay unmounting altogether — has to hand
    // it back, because off its own route this control is not even on screen to
    // take the choice back off. `QaSurfaceGuard` keeps the same contract for the
    // body mask and the host's own icons. The snapshot is retaken on every run,
    // so a Host repaint between two of them is a repaint the restore returns to,
    // not one it overwrites.
    const worn = readQaThemePaintState(document);
    applyQaThemePreference(document, stored, systemDark);
    return () => {
      writeQaThemePaintState(document, worn);
    };
  }, [active, stored, systemDark]);

  const select = useCallback(
    (next: QaThemePreference) => {
      writeQaThemePreference(storage, storageKey, next);
      setStored(next);
    },
    [storage, storageKey],
  );

  const painted = useSyncExternalStore(
    subscribeQaThemeScheme,
    getQaThemeSchemeSnapshot,
  );

  return {
    // With no choice of its own, this browser reports what the document is
    // already painted with rather than claiming a preference nobody picked.
    preference: stored ?? painted,
    select,
  };
}
