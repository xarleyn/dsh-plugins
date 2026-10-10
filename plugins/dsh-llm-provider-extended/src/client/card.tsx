import {
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import { bindSettingsExternalStore } from "@yadsh/dsh-plugin-kit/client";
import type { PiAiProviderProfile } from "../upstream/config.js";
import { ProviderEditor } from "./editor.js";

export interface ProviderSettings {
  providers: Record<string, PiAiProviderProfile>;
}
export interface ProviderCardFace {
  settingsForm: ConfigForm<ProviderSettings>;
}
export const ROW_SUMMARY =
  "Full provider profiles, generation defaults and typed System One requests.";

/** The Host owns the row frame; this component renders its configuration body. */
export function ProviderCard({ settingsForm }: ProviderCardFace): ReactElement {
  const store = useMemo(
    () => bindSettingsExternalStore(settingsForm),
    [settingsForm],
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const [selection, setSelection] = useState<string | null>(null);
  const [editRevision, setEditRevision] = useState<number | undefined>();
  const [route, setRoute] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const providers = snapshot.value?.providers ?? {};
  const writable =
    snapshot.status === "ready" &&
    snapshot.writable &&
    snapshot.revision !== undefined &&
    !busy;
  const mutate = async (
    id: string,
    profile: PiAiProviderProfile | undefined,
  ): Promise<void> => {
    if (!writable) return;
    setBusy(true);
    setError("");
    try {
      const result = await settingsForm.mutate(
        [
          profile === undefined
            ? { op: "unset", path: ["providers", id] }
            : { op: "set", path: ["providers", id], value: profile },
        ],
        editRevision,
      );
      if (!result)
        throw new Error(
          "Provider settings were not saved. Reopen the provider to refresh its revision, then retry.",
        );
      setSelection(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Provider settings could not be saved",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="provider-extended">
      {snapshot.status !== "ready" && (
        <p role="status">
          Provider settings are {snapshot.status}. This Host must expose a
          managed profile to edit providers.
        </p>
      )}
      {snapshot.status === "ready" && !snapshot.writable && (
        <p role="status">Provider settings are read-only in this browser.</p>
      )}
      <p>
        API keys and native sign-in are managed in Models settings. Enter a
        credential reference below; keys stay in the Host credential store or
        launch environment.
      </p>
      <div className="provider-extended__routes">
        {Object.entries(providers).map(([id, p]) => (
          <button
            type="button"
            disabled={busy}
            aria-pressed={selection === id}
            key={id}
            onClick={() => {
              setSelection(id);
              setEditRevision(snapshot.revision);
            }}
          >
            {p.displayName ?? id} <small>{id}</small>
          </button>
        ))}
      </div>
      <div className="provider-extended__add">
        <label>
          New provider route
          <input
            value={route}
            disabled={!writable}
            onChange={(e) => setRoute(e.target.value)}
            placeholder="local-gateway"
          />
        </label>
        <button
          type="button"
          disabled={
            !writable ||
            !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(route) ||
            Object.hasOwn(providers, route)
          }
          onClick={() => {
            setSelection("");
            setEditRevision(snapshot.revision);
            setError("");
          }}
        >
          Add provider
        </button>
      </div>
      {selection !== null && (
        <ProviderEditor
          key={`${selection || route}-${editRevision}`}
          route={selection || route}
          initial={
            providers[selection] ?? {
              displayName: route,
              api: "openai-completions",
              baseURL: "",
              models: [{ id: "", input: ["text"] }],
            }
          }
          writable={writable}
          save={(profile) => mutate(selection || route, profile)}
          remove={selection ? () => mutate(selection, undefined) : undefined}
          removeLabel={
            typeof snapshot.base === "object" &&
            snapshot.base !== null &&
            "providers" in snapshot.base &&
            Object.hasOwn(
              (snapshot.base as ProviderSettings).providers ?? {},
              selection ?? "",
            )
              ? "Restore composition provider"
              : "Delete provider"
          }
        />
      )}
      {busy && <p role="status">Saving provider settings…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
