/**
 * Add/Edit rule form (SPEC §6.2): the identity, match, auth and adapter fields
 * of one rule, with the network/redirect/limits half collapsed behind
 * `RuleAdvancedFields`. The form validates live and refuses to save a rule the
 * Host would reject.
 * @module client/sections/rule-editor
 */

import { useState } from "react";
import { CLEANUP_LEVELS } from "../../types.js";
import type {
  AuthenticatedFetchRule,
  AuthType,
  CleanupLevel,
} from "../../types.js";
import { CredentialControl } from "./credentials.js";
import { Field, ToggleRow, type CardFace } from "./common.js";
import { RuleAdvancedFields } from "./rule-advanced.js";
import {
  CLEANUP_LABELS,
  draftToRule,
  emptyDraft,
  ruleToDraft,
  type RuleDraft,
} from "./rule-draft.js";

/** Add/Edit rule form (SPEC §6.2). */
export function RuleEditor({
  initial,
  credentials,
  onSave,
  onCancel,
}: {
  initial: AuthenticatedFetchRule | undefined;
  credentials: CardFace["credentials"];
  onSave: (rule: AuthenticatedFetchRule) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<RuleDraft>(() =>
    initial === undefined ? emptyDraft() : ruleToDraft(initial),
  );
  const patch = (changes: Partial<RuleDraft>): void => {
    setDraft((current) => ({ ...current, ...changes }));
  };
  const { rule, errors } = draftToRule(draft);
  const credentialRef =
    draft.authType === "bearer" || draft.authType === "header"
      ? (draft.authType === "bearer" ? draft.bearerRef : draft.headerRef).trim()
      : draft.basicPasswordRef.trim();

  return (
    <div className="wfa-editor">
      <div className="wfa-grid">
        <Field label="Rule name">
          <input
            className="wfa-control"
            value={draft.name}
            onChange={(event) => {
              patch({ name: event.target.value });
            }}
          />
        </Field>
        <Field label="Description">
          <input
            className="wfa-control"
            value={draft.description}
            onChange={(event) => {
              patch({ description: event.target.value });
            }}
          />
        </Field>
      </div>
      <ToggleRow
        title="Enabled"
        hint="Disabled rules never match."
        checked={draft.enabled}
        disabled={false}
        onChange={(next) => {
          patch({ enabled: next });
        }}
      />

      <div className="wfa-grid">
        <Field label="Hostnames (one per line, exact)">
          <textarea
            className="wfa-control"
            rows={2}
            value={draft.hosts}
            placeholder={"jira.example.corp\nwiki.example.corp"}
            onChange={(event) => {
              patch({ hosts: event.target.value });
            }}
          />
        </Field>
        <Field label="Ports (optional, comma separated)">
          <input
            className="wfa-control"
            value={draft.ports}
            placeholder="443, 8443"
            onChange={(event) => {
              patch({ ports: event.target.value });
            }}
          />
        </Field>
      </div>
      <ToggleRow
        title="Allow http://"
        hint="HTTPS is always allowed; adding http warns and transmits the credential unencrypted."
        checked={draft.schemesHttp}
        disabled={false}
        onChange={(next) => {
          patch({ schemesHttp: next });
        }}
      />
      <div className="wfa-grid">
        <Field label="Allowed path patterns (optional, one per line)">
          <textarea
            className="wfa-control"
            rows={2}
            value={draft.allowPaths}
            placeholder={"/browse/**\n/rest/api/**"}
            onChange={(event) => {
              patch({ allowPaths: event.target.value });
            }}
          />
        </Field>
        <Field label="Denied path patterns (optional)">
          <textarea
            className="wfa-control"
            rows={2}
            value={draft.denyPaths}
            placeholder="/rest/api/*/settings/**"
            onChange={(event) => {
              patch({ denyPaths: event.target.value });
            }}
          />
        </Field>
      </div>

      <div className="wfa-grid">
        <Field label="Authentication">
          <select
            className="wfa-control"
            value={draft.authType}
            onChange={(event) => {
              patch({ authType: event.target.value as AuthType });
            }}
          >
            <option value="none">None</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic auth</option>
            <option value="header">API key header</option>
          </select>
        </Field>
        {draft.authType === "header" && (
          <Field label="Header name">
            <input
              className="wfa-control"
              value={draft.headerName}
              placeholder="X-API-Key"
              onChange={(event) => {
                patch({ headerName: event.target.value });
              }}
            />
          </Field>
        )}
        {draft.authType === "basic" && (
          <Field label="Username">
            <input
              className="wfa-control"
              value={draft.basicUsername}
              onChange={(event) => {
                patch({ basicUsername: event.target.value });
              }}
            />
          </Field>
        )}
      </div>
      {draft.authType === "header" && (
        <div className="wfa-grid">
          <Field label="Value prefix (optional)">
            <input
              className="wfa-control"
              value={draft.headerPrefix}
              placeholder="ApiKey "
              onChange={(event) => {
                patch({ headerPrefix: event.target.value });
              }}
            />
          </Field>
        </div>
      )}
      {draft.authType !== "none" && (
        <CredentialControl
          refName={credentialRef}
          onRefChange={(next) => {
            if (draft.authType === "bearer") patch({ bearerRef: next });
            else if (draft.authType === "basic")
              patch({ basicPasswordRef: next });
            else patch({ headerRef: next });
          }}
          credentials={credentials}
        />
      )}

      <div className="wfa-grid">
        <Field label="Content adapter">
          <select
            className="wfa-control"
            value={draft.adapterType}
            onChange={(event) => {
              patch({
                adapterType: event.target.value as RuleDraft["adapterType"],
              });
            }}
          >
            <option value="none">Raw HTTP/HTML</option>
            <option value="jira">Jira issue (REST → clean text)</option>
            <option value="confluence">
              Confluence page (REST → clean text)
            </option>
          </select>
        </Field>
        {draft.adapterType === "jira" && (
          <Field label="Jira flavor">
            <select
              className="wfa-control"
              value={draft.jiraFlavor}
              onChange={(event) => {
                patch({
                  jiraFlavor: event.target.value as RuleDraft["jiraFlavor"],
                });
              }}
            >
              <option value="server">
                Server / Data Center (REST v2, wiki markup)
              </option>
              <option value="cloud">
                Cloud (REST v3, Atlassian Document Format)
              </option>
            </select>
          </Field>
        )}
        {draft.adapterType === "confluence" && (
          <Field label="Page cleanup">
            <select
              className="wfa-control"
              value={draft.cleanup}
              onChange={(event) => {
                patch({
                  cleanup: event.target.value as CleanupLevel,
                });
              }}
            >
              {CLEANUP_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {CLEANUP_LABELS[level]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {draft.adapterType === "jira" && (
        <div className="wfa-checks">
          <label className="wfa-check">
            <input
              type="checkbox"
              checked={draft.includeComments}
              onChange={(event) => {
                patch({ includeComments: event.target.checked });
              }}
            />
            Include comments
          </label>
          <label className="wfa-check">
            <input
              type="checkbox"
              checked={draft.includeLinks}
              onChange={(event) => {
                patch({ includeLinks: event.target.checked });
              }}
            />
            Include issue links
          </label>
        </div>
      )}
      {draft.adapterType !== "none" && (
        <p className="wfa-note">
          Recognized URLs (
          {draft.adapterType === "jira"
            ? "/browse/ISSUE-KEY"
            : "/pages/<id>, /pages/viewpage.action?pageId=<id>, /display/SPACE/Title"}
          ) are fetched from the product REST API with the same credentials and
          policy and returned as clean Markdown text; everything else falls back
          to raw HTTP/HTML.
          {draft.adapterType === "confluence" && (
            <>
              {" "}
              Page cleanup decides how much of the page's own chrome survives:
              {" “No trimming”"} keeps every macro/attachment marker,
              {" “Trim chrome”"} drops navigation macros but keeps links and
              attachments, {"“Content only”"} keeps the readable text alone.
            </>
          )}
        </p>
      )}

      <RuleAdvancedFields draft={draft} patch={patch} />

      {errors.length > 0 && (
        <div className="wfa-error">
          {errors.map((error, index) => (
            <div key={index}>{error}</div>
          ))}
        </div>
      )}
      <div className="wfa-actions">
        <button
          className="wfa-btn primary"
          type="button"
          disabled={errors.length > 0}
          onClick={() => {
            onSave(rule);
          }}
        >
          Save rule
        </button>
        <button className="wfa-btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
