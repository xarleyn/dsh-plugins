/**
 * Global switch and limit defaults (SPEC §23): the provider enable toggle, the
 * audit log, and the three limits a rule inherits when it sets none.
 * @module client/sections/global
 */

import type { WebFetchAuthConfig } from "../../types.js";
import { parsePositiveInt } from "../format.js";
import { Field, ToggleRow } from "./common.js";

/** Global switch and limit defaults (SPEC §23). */
export function GlobalSection({
  config,
  writable,
  setPath,
}: {
  config: WebFetchAuthConfig | undefined;
  writable: boolean;
  setPath: (path: string[], value: unknown) => void;
}): JSX.Element {
  const limits = config?.limits;
  return (
    <section className="wfa-section">
      <div className="wfa-section-title">
        <h3>Global</h3>
      </div>
      <ToggleRow
        title="Provider enabled"
        hint="Disabled providers report unavailable to ctx.web."
        checked={config?.enabled ?? true}
        disabled={!writable}
        onChange={(next) => {
          setPath(["enabled"], next);
        }}
      />
      <ToggleRow
        title="Audit log"
        hint="Sanitized per-request records in the plugin log; never secrets."
        checked={config?.audit?.enabled ?? true}
        disabled={!writable}
        onChange={(next) => {
          setPath(["audit", "enabled"], next);
        }}
      />
      <div className="wfa-grid">
        <Field label="Default timeout (ms)">
          <input
            className="wfa-control"
            inputMode="numeric"
            disabled={!writable}
            value={
              limits?.timeoutMs === undefined ? "" : String(limits.timeoutMs)
            }
            onChange={(event) => {
              const value = parsePositiveInt(event.target.value);
              const current = config?.limits ?? {};
              if (value === undefined && event.target.value.trim() !== "")
                return;
              const next = { ...current };
              if (value === undefined) delete next.timeoutMs;
              else next.timeoutMs = value;
              setPath(["limits"], next);
            }}
          />
        </Field>
        <Field label="Max response size (bytes)">
          <input
            className="wfa-control"
            inputMode="numeric"
            disabled={!writable}
            value={
              limits?.maxResponseBytes === undefined
                ? ""
                : String(limits.maxResponseBytes)
            }
            onChange={(event) => {
              const value = parsePositiveInt(event.target.value);
              const current = config?.limits ?? {};
              if (value === undefined && event.target.value.trim() !== "")
                return;
              const next = { ...current };
              if (value === undefined) delete next.maxResponseBytes;
              else next.maxResponseBytes = value;
              setPath(["limits"], next);
            }}
          />
        </Field>
        <Field label="Max decoded body (chars)">
          <input
            className="wfa-control"
            inputMode="numeric"
            disabled={!writable}
            value={
              limits?.maxBodyChars === undefined
                ? ""
                : String(limits.maxBodyChars)
            }
            onChange={(event) => {
              const value = parsePositiveInt(event.target.value);
              const current = config?.limits ?? {};
              if (value === undefined && event.target.value.trim() !== "")
                return;
              const next = { ...current };
              if (value === undefined) delete next.maxBodyChars;
              else next.maxBodyChars = value;
              setPath(["limits"], next);
            }}
          />
        </Field>
      </div>
    </section>
  );
}
