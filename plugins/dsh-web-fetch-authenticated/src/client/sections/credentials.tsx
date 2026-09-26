/**
 * The credential control of the rule editor (SPEC §6.2).
 * @module client/sections/credentials
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Field, Pill, type CardFace } from "./common.js";

/** Write-only credential control (SPEC §6.2/§21): values leave once, never return. */
export function CredentialControl({
  refName,
  onRefChange,
  credentials,
}: {
  refName: string;
  onRefChange: (next: string) => void;
  credentials: CardFace["credentials"];
}): JSX.Element {
  const [secret, setSecret] = useState("");
  const [state, setState] = useState<
    { configured: boolean; writable: boolean } | undefined
  >();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const activeRef = useRef(refName);

  useEffect(() => {
    activeRef.current = refName;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(refName)) {
      setState(undefined);
      return;
    }
    let cancelled = false;
    void credentials
      .describe([refName])
      .then((response) => {
        if (cancelled) return;
        if (response.ok) {
          const view = response.value[refName];
          setState({
            configured: view?.configured ?? false,
            writable: view?.writable ?? true,
          });
        } else {
          setState(undefined);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refName, credentials]);

  const save = useCallback(async () => {
    if (secret.length === 0) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const written = await credentials.set(refName, secret);
      if (!written.ok) {
        setMessage("The Host refused the write (read-only source?).");
        return;
      }
      setSecret("");
      const response = await credentials.describe([refName]);
      if (response.ok) {
        const view = response.value[refName];
        setState({
          configured: view?.configured ?? false,
          writable: view?.writable ?? true,
        });
      }
      setMessage("Credential stored.");
    } catch {
      setMessage("The Host refused the write (read-only source?).");
    } finally {
      setBusy(false);
    }
  }, [credentials, refName, secret]);

  const clear = useCallback(async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const removed = await credentials.unset(refName);
      if (!removed.ok) {
        setMessage("The Host refused the removal.");
        return;
      }
      const response = await credentials.describe([refName]);
      if (response.ok) {
        const view = response.value[refName];
        setState({
          configured: view?.configured ?? false,
          writable: view?.writable ?? true,
        });
      }
      setMessage("Credential removed.");
    } catch {
      setMessage("The Host refused the removal.");
    } finally {
      setBusy(false);
    }
  }, [credentials, refName]);

  return (
    <div className="wfa-field">
      <span>Credential</span>
      <div className="wfa-grid">
        <Field label="Reference name">
          <input
            className="wfa-control"
            value={refName}
            placeholder="CORP_JIRA_TOKEN"
            onChange={(event) => {
              onRefChange(event.target.value);
            }}
          />
        </Field>
        <Field
          label={`Secret value ${state?.configured === true ? "(configured — leave blank to keep)" : ""}`}
        >
          <input
            className="wfa-control"
            type="password"
            autoComplete="off"
            value={secret}
            placeholder={
              state?.configured === true ? "••••••••" : "paste the secret"
            }
            onChange={(event) => {
              setSecret(event.target.value);
            }}
          />
        </Field>
      </div>
      <div className="wfa-actions">
        <Pill
          tone={state === undefined ? "warn" : state.configured ? "ok" : "err"}
        >
          {state === undefined
            ? "unknown"
            : state.configured
              ? "configured"
              : "not configured"}
        </Pill>
        <button
          className="wfa-btn"
          type="button"
          disabled={
            busy ||
            secret.length === 0 ||
            !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(refName)
          }
          onClick={() => {
            void save();
          }}
        >
          Save secret
        </button>
        <button
          className="wfa-btn danger"
          type="button"
          disabled={busy || state?.configured !== true}
          onClick={() => {
            void clear();
          }}
        >
          Remove
        </button>
      </div>
      {message !== undefined && <p className="wfa-note">{message}</p>}
      <p className="wfa-note">
        The secret is written once to the DSH credential store under the
        reference name above; the rule config keeps only the name. Values are
        never returned to this page.
      </p>
    </div>
  );
}
