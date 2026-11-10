import { useCallback, useEffect, useState } from "react";
import {
  parseHistoryOrganization,
  type QaHistoryOrganization,
} from "./history-organization.js";

const HISTORY_CHANGED = "dsh-qa-history-changed";

/** The catalog is keyed on mount, so changing accounts cannot reuse its state. */
export function useHistoryOrganization(key: string) {
  const read = useCallback(() => {
    try {
      return parseHistoryOrganization(window.localStorage.getItem(key));
    } catch {
      return parseHistoryOrganization(null);
    }
  }, [key]);
  const [state, setState] = useState(read);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (
        event.storageArea !== null &&
        event.storageArea !== window.localStorage
      )
        return;
      if (event.key === key || event.key === null) setState(read());
    };
    window.addEventListener("storage", sync);
    const sameTab = (event: Event) => {
      if ((event as CustomEvent<string>).detail === key) setState(read());
    };
    window.addEventListener(HISTORY_CHANGED, sameTab);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(HISTORY_CHANGED, sameTab);
    };
  }, [key, read]);
  const update = useCallback(
    (next: QaHistoryOrganization) => {
      setState(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
        setPersistenceFailed(false);
        window.dispatchEvent(new CustomEvent(HISTORY_CHANGED, { detail: key }));
      } catch {
        setPersistenceFailed(true);
      }
    },
    [key],
  );
  return { state, update, persistenceFailed };
}
