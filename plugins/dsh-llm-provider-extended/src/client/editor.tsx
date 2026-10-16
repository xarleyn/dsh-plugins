import { useState, type ReactElement } from "react";
import type {
  PiAiProviderProfile,
  PiAiModelProfile,
} from "../upstream/config.js";
import type { GenerationDefaults } from "../generation.js";

const protocols = [
  ["", "Provider catalog default"],
  ["openai-completions", "OpenAI Chat Completions"],
  ["openai-responses", "OpenAI Responses"],
  ["anthropic-messages", "Anthropic Messages"],
  ["systemone", "System One (typed decisions)"],
];
const knobs: Record<string, readonly (keyof GenerationDefaults)[]> = {
  "openai-completions": [
    "temperature",
    "topP",
    "topK",
    "minP",
    "frequencyPenalty",
    "presencePenalty",
    "seed",
  ],
  "openai-responses": ["temperature", "topP"],
  "anthropic-messages": ["temperature", "topP", "topK"],
  systemone: [],
};
const labels: Record<string, string> = {
  temperature: "Temperature",
  topP: "Top P",
  topK: "Top K",
  minP: "Min P",
  frequencyPenalty: "Frequency penalty",
  presencePenalty: "Presence penalty",
  seed: "Seed",
};
function setOptional<T extends object>(
  object: T,
  key: keyof T,
  value: unknown,
): T {
  const next = { ...object };
  if (value === undefined) delete next[key];
  else Object.assign(next, { [key]: value });
  return next;
}

function GenerationFields({
  value = {},
  api,
  change,
  disabled,
}: {
  value: GenerationDefaults | undefined;
  api: string;
  change: (value: GenerationDefaults) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <div className="provider-extended__grid">
      {(knobs[api] ?? ["temperature"]).map((key) => (
        <label key={key}>
          {labels[key]}
          <input
            type="number"
            step={key === "seed" || key === "topK" ? 1 : "any"}
            value={(value[key] as number | undefined) ?? ""}
            disabled={disabled}
            placeholder="Provider default"
            onChange={(e) =>
              change(
                setOptional(
                  value,
                  key,
                  e.target.value === "" ? undefined : Number(e.target.value),
                ),
              )
            }
          />
        </label>
      ))}
      {["openai-completions", "anthropic-messages"].includes(api) && (
        <label>
          Stop sequences (one per line)
          <textarea
            value={value.stop?.join("\n") ?? ""}
            disabled={disabled}
            onChange={(e) =>
              change(
                setOptional(
                  value,
                  "stop",
                  e.target.value === ""
                    ? undefined
                    : e.target.value.split("\n"),
                ),
              )
            }
          />
        </label>
      )}
    </div>
  );
}

export function ProviderEditor({
  route,
  initial,
  writable,
  save,
  remove,
  removeLabel,
}: {
  route: string;
  initial: PiAiProviderProfile;
  writable: boolean;
  save: (profile: PiAiProviderProfile) => Promise<void>;
  remove: (() => Promise<void>) | undefined;
  removeLabel: string;
}): ReactElement {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [advanced, setAdvanced] = useState("");
  const [error, setError] = useState("");
  const native = draft.api === "systemone";
  const set = (key: keyof PiAiProviderProfile, value: unknown): void => {
    setDraft((current) => setOptional(current, key, value));
  };
  const model = (index: number, patch: Partial<PiAiModelProfile>): void =>
    set(
      "models",
      draft.models?.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      ),
    );
  return (
    <section aria-label={`Provider ${route}`}>
      <p>
        Route: <strong>{route}</strong>
      </p>
      <fieldset disabled={!writable}>
        <div className="provider-extended__grid">
          <label>
            Display name
            <input
              value={draft.displayName ?? ""}
              onChange={(e) => set("displayName", e.target.value || undefined)}
            />
          </label>
          <label>
            Base URL
            <input
              value={draft.baseURL ?? ""}
              placeholder="https://gateway.example.com/v1"
              onChange={(e) => set("baseURL", e.target.value || undefined)}
            />
          </label>
          <label>
            Credential reference
            <input
              value={draft.apiKeyEnv ?? ""}
              placeholder="PROVIDER_API_KEY"
              onChange={(e) => set("apiKeyEnv", e.target.value || undefined)}
            />
          </label>
          <label>
            API protocol
            <select
              value={draft.api ?? ""}
              onChange={(e) => set("api", e.target.value || undefined)}
            >
              {protocols.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {native ? (
          <p>
            System One takes a JSON state/questions request and returns choice,
            score or noul results. It has no chat, tools, streaming, sampling,
            image input or output cap. Remove incompatible fields before saving
            an existing chat profile.
          </p>
        ) : (
          <>
            <label>
              <input
                type="checkbox"
                checked={draft.userIdentity === "qa-account"}
                onChange={(e) =>
                  set(
                    "userIdentity",
                    e.target.checked ? "qa-account" : undefined,
                  )
                }
              />
              Require QA account identity (DeepSeek)
            </label>
            <p>
              Uses one shared API key and an opaque ID for each QA chat owner.
              Enable only on a gateway supporting DeepSeek user isolation.
              Requests without an active QA owner are refused.
            </p>
            <p>
              Empty generation fields inherit the provider default. Top K, Min P
              and Seed require a chat gateway that supports those extensions.
            </p>
            <GenerationFields
              value={draft.generation}
              api={draft.api ?? ""}
              change={(value) => set("generation", value)}
              disabled={!writable}
            />
          </>
        )}
        <div className="provider-extended__models">
          {(draft.models ?? []).map((entry, index) => (
            <div key={index} className="provider-extended__model">
              <div className="provider-extended__grid">
                <label>
                  Model ID
                  <input
                    value={entry.id}
                    onChange={(e) => model(index, { id: e.target.value })}
                  />
                </label>
                <label>
                  Model display name
                  <input
                    value={entry.name ?? ""}
                    onChange={(e) => model(index, { name: e.target.value })}
                  />
                </label>
                <label>
                  Context window
                  <input
                    type="number"
                    min="1"
                    value={entry.contextWindow ?? ""}
                    onChange={(e) => {
                      const next = setOptional(
                        entry,
                        "contextWindow",
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                      );
                      set(
                        "models",
                        draft.models?.map((m, i) => (i === index ? next : m)),
                      );
                    }}
                  />
                </label>
                {!native && (
                  <label>
                    Max output tokens
                    <input
                      type="number"
                      min="1"
                      value={entry.maxTokens ?? ""}
                      onChange={(e) => {
                        const next = setOptional(
                          entry,
                          "maxTokens",
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                        );
                        set(
                          "models",
                          draft.models?.map((m, i) => (i === index ? next : m)),
                        );
                      }}
                    />
                  </label>
                )}
              </div>
              {!native && (
                <>
                  <label>
                    <input
                      type="checkbox"
                      checked={entry.input?.includes("image") ?? false}
                      onChange={(e) =>
                        model(index, {
                          input: e.target.checked
                            ? ["text", "image"]
                            : ["text"],
                        })
                      }
                    />{" "}
                    Image input
                  </label>
                  <details>
                    <summary>Model generation overrides</summary>
                    <GenerationFields
                      value={entry.generation}
                      api={draft.api ?? ""}
                      disabled={!writable}
                      change={(generation) => model(index, { generation })}
                    />
                  </details>
                </>
              )}
              <button
                type="button"
                onClick={() =>
                  set(
                    "models",
                    draft.models?.filter((_, i) => i !== index),
                  )
                }
              >
                Remove model {index + 1}
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            set("models", [
              ...(draft.models ?? []),
              { id: "", input: ["text"] },
            ])
          }
        >
          Add model
        </button>
        {!native && (
          <p>
            Omit the model list in Advanced profile to inherit the installed
            provider catalog. Fetch available models and manage API keys or
            native login in the Host Models page.
          </p>
        )}
        <details
          onToggle={(e) => {
            if (e.currentTarget.open)
              setAdvanced(JSON.stringify(draft, null, 2));
          }}
        >
          <summary>Advanced profile (all provider options)</summary>
          <p>
            Includes reasoning, compatibility, headers, transport, retry policy,
            image budgets and all model overrides. Use credential references;
            this profile is not a secret store.
          </p>
          <textarea
            aria-label="Advanced profile JSON"
            rows={16}
            value={advanced}
            onChange={(e) => setAdvanced(e.target.value)}
          />
          <button
            type="button"
            onClick={() => {
              try {
                const parsed: unknown = JSON.parse(advanced);
                if (
                  typeof parsed !== "object" ||
                  parsed === null ||
                  Array.isArray(parsed)
                )
                  throw new Error("Profile must be a JSON object");
                setDraft(parsed as PiAiProviderProfile);
                setError("");
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "Invalid profile",
                );
              }
            }}
          >
            Apply JSON to draft
          </button>
        </details>
        <div className="provider-extended__actions">
          <button
            type="button"
            onClick={() => {
              setError("");
              void save(draft);
            }}
          >
            Save provider
          </button>
          {remove && (
            <button type="button" onClick={() => void remove()}>
              {removeLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setDraft(structuredClone(initial));
              setError("");
            }}
          >
            Restore saved values
          </button>
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
