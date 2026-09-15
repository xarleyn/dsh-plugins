import { useCallback, useEffect, useState } from "react";
import type { RemoteResult } from "../types.js";
import { formatRelative } from "./format.js";

/** The audience-safe text of a refused Remote call. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error !== null && typeof error === "object" && "message" in error) {
    return String((error as { readonly message?: unknown }).message ?? error);
  }
  return String(error);
}

/**
 * The refusal copy a console page shows. The Host sends a coarse reason code
 * on the wire and nothing else, so the wording lives here — one place to edit,
 * and no deployment detail leaks into the browser.
 */
export function adminErrorMessage(error: unknown): string {
  const message = errorMessage(error);
  if (/reason: forbidden/u.test(message)) {
    return "У вашей роли нет прав на это действие.";
  }
  if (/reason: auth-required/u.test(message)) {
    return "Сессия истекла: войдите заново.";
  }
  if (/QA accounts are not enabled/u.test(message)) {
    return "Учётные записи на этом стенде выключены.";
  }
  return message;
}

/**
 * Load one administrative resource, keeping the previous value visible while
 * it refreshes. Reviewers page through lists while new conversations arrive;
 * blanking the table on every reload would make that unusable.
 */
export function useAdminResource<T>(
  load: () => Promise<RemoteResult<T>>,
  deps: readonly unknown[],
): {
  readonly data: T | undefined;
  readonly error: string | undefined;
  readonly loading: boolean;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await load();
      if (result.ok) {
        setData(result.value);
        setError(undefined);
      } else {
        setError(errorMessage(result.error));
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
    // The caller owns the identity of `load`: every page passes a callback
    // rebuilt from its own state, and lists the state in `deps`.
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

/** A status chip; the modifier class carries the semantic colour. */
export function Badge(props: {
  readonly tone?: "neutral" | "positive" | "negative" | "warning";
  readonly children: React.ReactNode;
}) {
  return (
    <span
      className={`dsh-qa-admin__badge${
        props.tone === undefined ? "" : ` dsh-qa-admin__badge--${props.tone}`
      }`}
    >
      {props.children}
    </span>
  );
}

export function Empty(props: { readonly children: React.ReactNode }) {
  return <p className="dsh-qa-admin__empty">{props.children}</p>;
}

/** A relative timestamp with the exact one available on hover. */
export function Stamp(props: { readonly value: string | undefined }) {
  return (
    <time
      className="dsh-qa-admin__stamp"
      dateTime={props.value}
      title={props.value}
    >
      {props.value === undefined ? "—" : formatRelative(props.value)}
    </time>
  );
}

export function ErrorLine(props: { readonly message: string | undefined }) {
  return props.message === undefined ? null : (
    <p className="dsh-qa-admin__error" role="alert">
      {props.message}
    </p>
  );
}

/**
 * Cursor paging controls. The cursor is opaque to the browser by design: only
 * the Host knows how a page was cut.
 */
export function Pager(props: {
  readonly total: number;
  readonly shown: number;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly onMore: () => void;
  readonly onReset: () => void;
}) {
  return (
    <div className="dsh-qa-admin__pager">
      <span>
        Показано {props.shown} из {props.total}
      </span>
      {props.hasMore ? (
        <button type="button" disabled={props.loading} onClick={props.onMore}>
          Показать ещё
        </button>
      ) : null}
      {props.shown > 0 && props.hasMore ? (
        <button type="button" onClick={props.onReset}>
          Сначала
        </button>
      ) : null}
    </div>
  );
}

/** One labeled filter control in a table toolbar. */
export function FilterField(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="dsh-qa-admin__filter">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}
