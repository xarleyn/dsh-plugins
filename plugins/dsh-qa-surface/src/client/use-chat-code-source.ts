import { useCallback, useEffect, useRef, useState } from "react";
import type { CodeSourcesCatalog } from "@yadsh/dsh-plugin-kit/code-sources";
import type { QaChatCodeSources } from "../types/code-sources.js";
import type { QaChatCodeSourceApi } from "./types.js";

interface State {
  readonly value: QaChatCodeSources;
  readonly pending: boolean;
  readonly error: string | null;
}
export interface ChatCodeSourceOptions {
  readonly api?: QaChatCodeSourceApi | undefined;
  readonly token: string;
  readonly sessionId: string | null;
  readonly chatKey: number;
  readonly catalog: CodeSourcesCatalog;
}

function draftState(
  catalog: CodeSourcesCatalog,
  selected: string | null = null,
): QaChatCodeSources {
  const effectiveSource =
    selected ??
    (catalog.defaultSource ||
      (catalog.entries.length === 1 ? catalog.entries[0]!.id : null));
  return {
    selectedSource: selected,
    effectiveSource,
    entries: catalog.entries.map(({ id, label }) => ({ id, label })),
    writable: true,
    unavailable:
      effectiveSource !== null &&
      !catalog.entries.some((entry) => entry.id === effectiveSource),
  };
}

/** Server-backed per-chat state. Drafts do not create sessions until their first send. */
export function useChatCodeSource(options: ChatCodeSourceOptions) {
  const [state, setState] = useState<State>(() => ({
    value: draftState(options.catalog),
    pending: false,
    error: null,
  }));
  const current = useRef(options);
  current.current = options;
  const sequence = useRef(0);
  const selection = useRef<string | null>(null);
  const saving = useRef(false);
  const key = useRef(options.chatKey);
  if (key.current !== options.chatKey) {
    key.current = options.chatKey;
    selection.current = null;
    sequence.current++;
    saving.current = false;
  }

  useEffect(() => {
    let disposed = false;
    let reading = false;
    const refresh = async (initial = false) => {
      if (saving.current || reading) return;
      const operation = ++sequence.current;
      if (options.sessionId === null || options.api === undefined) {
        setState({
          value: draftState(options.catalog, selection.current),
          pending: false,
          error: null,
        });
        return;
      }
      reading = true;
      if (initial)
        setState({
          value: draftState(options.catalog, selection.current),
          pending: true,
          error: null,
        });
      try {
        const result = await options.api.read(options.token, options.sessionId);
        if (disposed || operation !== sequence.current) return;
        if (!result.ok) throw new Error("read failed");
        selection.current = result.value.selectedSource;
        setState({ value: result.value, pending: false, error: null });
      } catch {
        if (!disposed && operation === sequence.current)
          setState((prior) => ({
            ...prior,
            pending: false,
            error: "Не удалось прочитать версию чата. Повторите загрузку.",
          }));
      } finally {
        reading = false;
      }
    };
    void refresh(true);
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      disposed = true;
      sequence.current++;
      clearInterval(timer);
    };
  }, [
    options.api,
    options.token,
    options.sessionId,
    options.chatKey,
    options.catalog,
  ]);

  const select = useCallback(async (source: string | null) => {
    if (saving.current) return;
    const request = current.current;
    const operation = ++sequence.current;
    if (request.sessionId === null) {
      selection.current = source;
      setState({
        value: draftState(request.catalog, source),
        pending: false,
        error: null,
      });
      return;
    }
    if (request.api === undefined) return;
    saving.current = true;
    setState((prior) => ({ ...prior, pending: true, error: null }));
    try {
      const result = await request.api.select(
        request.token,
        request.sessionId,
        source,
      );
      if (operation !== sequence.current) return;
      if (!result.ok) throw new Error("save failed");
      selection.current = result.value.selectedSource;
      setState({ value: result.value, pending: false, error: null });
    } catch {
      if (operation === sequence.current)
        setState((prior) => ({
          ...prior,
          pending: false,
          error:
            "Не удалось сохранить версию. Выбор не изменён; дождитесь завершения ответа и повторите.",
        }));
    } finally {
      if (operation === sequence.current) saving.current = false;
    }
  }, []);

  const prepareSession = useCallback(async (sessionId: string) => {
    const request = current.current;
    const source = selection.current;
    if (request.api === undefined || source === null) return;
    const result = await request.api.select(request.token, sessionId, source);
    if (!result.ok)
      throw new Error("Не удалось сохранить версию перед первым сообщением.");
  }, []);
  return {
    ...state,
    select,
    prepareSession,
    blocked:
      options.api !== undefined &&
      options.catalog.entries.length > 0 &&
      (state.pending ||
        state.error !== null ||
        state.value.unavailable ||
        state.value.effectiveSource === null),
  };
}
