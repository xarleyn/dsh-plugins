import { useState, type ReactElement } from "react";
import {
  compilePrivacyRules,
  PrivacyFilter,
  type PrivacySettings,
} from "../privacy-rules.js";
import { maskPayload } from "../privacy-payload.js";

export function PrivacyFields({
  value,
  change,
}: {
  value: PrivacySettings | undefined;
  change: (value: PrivacySettings) => void;
}): ReactElement {
  const [sample, setSample] = useState("");
  const setText = (
    key: "dictionary" | "dictionaryEnv" | "masks",
    text: string,
  ): void => {
    const next = { ...value };
    if (text) next[key] = text;
    else delete next[key];
    change(next);
  };
  let preview = "";
  let error = "";
  if (value?.enabled) {
    try {
      const rules = compilePrivacyRules(value);
      preview = (
        maskPayload(
          { content: sample },
          new PrivacyFilter(rules, "preview"),
        ) as { content: string }
      ).content;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Invalid masking rules";
    }
  }
  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={value?.enabled ?? false}
          onChange={(event) =>
            change({ ...value, enabled: event.target.checked })
          }
        />
        Mask sensitive data before sending
      </label>
      {value?.enabled && (
        <>
          <p>
            Replaces labelled client names, email addresses, Russian phone
            numbers and currency amounts in chat requests. Chat replies show the
            original values as they stream. Image requests are refused.
          </p>
          <label>
            Additional names and phrases (one per line)
            <textarea
              rows={3}
              value={value.dictionary ?? ""}
              onChange={(event) => setText("dictionary", event.target.value)}
            />
          </label>
          <label>
            Private dictionary environment variable
            <input
              placeholder="DSH_PII_CLIENTS"
              value={value.dictionaryEnv ?? ""}
              onChange={(event) => setText("dictionaryEnv", event.target.value)}
            />
          </label>
          <p>
            People who can read this profile can see the inline list. Store
            confidential names in the server variable, one per line.
          </p>
          <label>
            Custom masks (one per line)
            <textarea
              rows={2}
              placeholder="INV-####"
              value={value.masks ?? ""}
              onChange={(event) => setText("masks", event.target.value)}
            />
          </label>
          <p>
            Use # for one digit and @ for one letter. A backslash makes the next
            character literal.
          </p>
          <label>
            Try the rules on sample text
            <textarea
              rows={2}
              maxLength={8192}
              value={sample}
              onChange={(event) => setSample(event.target.value)}
            />
          </label>
          {sample && !error && (
            <output aria-label="Masked preview">{preview}</output>
          )}
          {value.dictionaryEnv && (
            <p>
              The local preview uses only the inline rules. The provider also
              applies the private dictionary on the server.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
