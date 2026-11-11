import { useEffect, useRef, useState } from "react";
import type { QaModelOptions, QaModelPair } from "../types.js";
import type { QaAccessApi } from "./types.js";

export const qaModelKey = (pair: QaModelPair): string =>
  JSON.stringify([pair.provider, pair.model]);
export interface QaModelSelectionProps {
  readonly api: NonNullable<QaAccessApi["userModels"]>;
  readonly token: string;
  readonly sessionId: string | null;
  readonly subroleId: string | null;
  readonly preview: boolean;
  readonly disabled: boolean;
  readonly onSelect: (pair: QaModelPair) => Promise<string>;
}

/** The existing authenticated selection boundary shared by composer controls. */
export function useQaModelSelection(props: QaModelSelectionProps | undefined) {
  const [options, setOptions] = useState<QaModelOptions>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const api = props?.api;
  const token = props?.token;
  const sessionId = props?.sessionId;
  const subroleId = props?.subroleId;
  const preview = props?.preview;
  useEffect(() => {
    const revision = ++generation.current;
    setOptions(undefined);
    setError(undefined);
    if (api === undefined || token === undefined) return;
    void api(token, sessionId ?? null, subroleId ?? null, preview ?? false)
      .then((result) => {
        if (revision !== generation.current) return;
        if (result.ok) setOptions(result.value);
        else setError("Не удалось загрузить доступные модели.");
      })
      .catch(() => {
        if (revision === generation.current)
          setError("Не удалось загрузить доступные модели.");
      });
    return () => {
      generation.current++;
    };
  }, [api, token, sessionId, subroleId, preview, retry]);
  const selectedKey =
    options?.selected === undefined ? "" : qaModelKey(options.selected);
  const select = async (key: string): Promise<boolean> => {
    const pair = options?.choices.find((entry) => qaModelKey(entry) === key);
    if (
      props === undefined ||
      props.disabled ||
      saving.current ||
      pair === undefined
    )
      return false;
    if (key === selectedKey) return true;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const id = await props.onSelect(pair);
      if (!alive.current) return false;
      const revision = ++generation.current;
      const result = await props.api(
        props.token,
        id,
        props.subroleId,
        props.preview,
      );
      if (!alive.current || revision !== generation.current) return false;
      if (!result.ok) throw new Error("Не удалось обновить выбранную модель.");
      setOptions(result.value);
      return true;
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Не удалось сменить модель.",
        );
      return false;
    } finally {
      saving.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return {
    options,
    busy,
    error,
    selectedKey,
    select,
    selected: options?.models.find(
      (entry) => qaModelKey(entry) === selectedKey,
    ),
    disabled:
      props === undefined || props.disabled || busy || options === undefined,
    reload: () => setRetry((value) => value + 1),
  };
}
