import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RemoteResult } from "../types.js";
import { formatRelative } from "./copy.js";

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
  if (/reason: conversation-unknown/u.test(message)) {
    return "Такого разговора на стенде уже нет.";
  }
  if (/reason: conversation-live/u.test(message)) {
    return "Разговор открыт на стенде прямо сейчас — удалите его, когда он освободится.";
  }
  if (/reason: conversation-not-removable/u.test(message)) {
    return "На этом стенде удаление разговоров недоступно: журналы хранятся не файлами.";
  }
  return message;
}

/**
 * One cancellable request slot. A page that starts a second request has stopped
 * waiting for the first, and a page that is gone waits for nothing at all —
 * either way the abandoned call should end instead of holding its connection and
 * the deployment's log reader open. The aggregate pages take minutes to answer on
 * a real store, so an abandoned page used to keep working long after the reviewer
 * moved on, and the calls it queued behind it paid for that.
 */
export function useRequestSlot(): {
  readonly start: () => AbortController;
  readonly cancel: () => void;
} {
  const current = useRef<AbortController | undefined>(undefined);
  const start = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    return controller;
  }, []);
  const cancel = useCallback(() => {
    current.current?.abort();
    current.current = undefined;
  }, []);
  useEffect(() => cancel, [cancel]);
  // The page keeps this object in its dependency lists, so it must not be a new
  // literal on every render.
  return useMemo(() => ({ start, cancel }), [start, cancel]);
}

/**
 * Load one administrative resource, keeping the previous value visible while
 * it refreshes. Reviewers page through lists while new conversations arrive;
 * blanking the table on every reload would make that unusable.
 *
 * `load` receives the cancellation of the call it is making: pass it on to the
 * Remote, and a page the reviewer left stops being read on the server.
 */
export function useAdminResource<T>(
  load: (signal: AbortSignal) => Promise<RemoteResult<T>>,
  deps: readonly unknown[],
): {
  readonly data: T | undefined;
  readonly error: string | undefined;
  readonly loading: boolean;
  reload: () => Promise<void>;
  /** Adopt a value this page already holds, without re-asking the Host. */
  apply: (value: T) => void;
} {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const request = useRequestSlot();
  const apply = useCallback((value: T) => {
    setData(value);
    setError(undefined);
  }, []);
  const reload = useCallback(async () => {
    const controller = request.start();
    setLoading(true);
    try {
      const result = await load(controller.signal);
      // A call this page abandoned has no answer worth showing: writing it
      // anyway is how a stale scan replaced whatever the reviewer opened next.
      if (controller.signal.aborted) return;
      if (result.ok) {
        setData(result.value);
        setError(undefined);
      } else {
        setError(errorMessage(result.error));
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
    // The caller owns the identity of `load`: every page passes a callback
    // rebuilt from its own state, and lists the state in `deps`.
  }, deps);
  useEffect(() => {
    void reload();
    return request.cancel;
  }, [reload, request]);
  return { data, error, loading, reload, apply };
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
