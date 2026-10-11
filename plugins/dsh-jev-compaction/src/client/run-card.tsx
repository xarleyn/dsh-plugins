/**
 * The conversation card for one recorded Jev compaction run (SPEC §28).
 *
 * Collapsed by default and answering one question in that state: what did Jev
 * do to this session? Expanded, it says why it ran, how much it touched, what
 * it decided per result, and where to look for the originals.
 *
 * The card is a view over a durable session event and carries METADATA ONLY —
 * counts, seqs, scores. No pruned tool output, no prompt, no state body is
 * ever rendered from here, and none is in the payload to begin with. The
 * provenance line at the bottom says so, because a reader who cannot see what
 * was removed will otherwise assume the card hid it.
 *
 * The shell is this card's own rather than the shared `dsh-plugin-card` shell:
 * a transcript row is not a settings list item, and this bundle already
 * registers the Plugins-panel card, whose host draws that shell's frame.
 */

import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type { ReactElement } from "react";
import { useState } from "react";

import type { JevCompactionChatData } from "./conversation.js";

type CardProps = PropsRuntime<"conversation.chat.node", "jev-compaction">;

/** Grouped with a space — locale-independent and stable in tests. */
function group(value: number): string {
  const digits = Math.abs(Math.trunc(value)).toString();
  let out = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += " ";
    out += digits[index];
  }
  return value < 0 ? `-${out}` : out;
}

function clock(time: number): string {
  const date = new Date(time);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * The disclosure affordance. A plus that becomes a minus, drawn rather than
 * typed: a font glyph's shape and baseline move with the font, and this row is
 * rendered inside the host transcript.
 */
function DisclosureIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      className="jevc-run-icon"
      viewBox="0 0 14 14"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2.75 7h8.5" />
      {open ? null : <path d="M7 2.75v8.5" />}
    </svg>
  );
}

function RunCard({
  data,
}: {
  data: Extract<JevCompactionChatData, { view: "run" }>;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const run = data.run;
  const saved =
    run.tokensBefore !== null && run.tokensAfter !== null
      ? Math.max(0, run.tokensBefore - run.tokensAfter)
      : null;
  const percent =
    saved !== null && run.tokensBefore !== null && run.tokensBefore > 0
      ? `${((saved / run.tokensBefore) * 100).toFixed(0)}%`
      : null;

  // Three states, and the card never blurs them: a queued run has not
  // touched the surface, a dry-run deliberately never would, and only an
  // applied run has. Anything an operator could read as "my context just got
  // smaller" has to be true.
  const landed = run.applied > 0;
  const queued = !landed && run.trigger === "queued";
  const preview = !landed;
  const headline = queued
    ? `${group(run.mutations)} results queued for the next step`
    : run.mode === "dry-run"
      ? `${group(run.mutations)} results would be replaced`
      : `${group(run.applied)} results replaced`;
  const tokens =
    run.tokensBefore !== null && run.tokensAfter !== null
      ? `${preview ? "estimated " : ""}${group(run.tokensBefore)} → ${group(
          run.tokensAfter,
        )} tokens`
      : "token estimate unavailable";
  const badge = queued
    ? "queued"
    : run.mode === "dry-run"
      ? "dry-run"
      : run.mode;

  return (
    <div className="jevc-run">
      <button
        type="button"
        className="jevc-run-header"
        aria-expanded={expanded}
        aria-label={
          expanded
            ? "Hide the Jev compaction report"
            : "Show the Jev compaction report"
        }
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="jevc-run-title">Jev compaction</span>
        <span
          className={`jevc-run-badge jevc-run-badge--${
            queued ? "queued" : run.mode
          }`}
        >
          {badge}
        </span>
        <DisclosureIcon open={expanded} />
      </button>
      <div className="jevc-run-summary">
        <span>{headline}</span>
        <span className="jevc-run-sep">·</span>
        <span>{tokens}</span>
        {saved !== null && percent !== null ? (
          <>
            <span className="jevc-run-sep">·</span>
            <span className="jevc-run-saved">
              {preview ? "estimated " : ""}
              {group(saved)} saved ({percent})
            </span>
          </>
        ) : null}
        <span className="jevc-run-time">{clock(data.time)}</span>
      </div>
      {expanded ? (
        <div className="jevc-run-body">
          <dl className="jevc-run-facts">
            <div className="jevc-run-fact">
              <dt>Candidates</dt>
              <dd>{group(run.candidates)}</dd>
            </div>
            <div className="jevc-run-fact">
              <dt>Planned</dt>
              <dd>{group(run.mutations)}</dd>
            </div>
            <div className="jevc-run-fact">
              <dt>Applied</dt>
              <dd>{group(run.applied)}</dd>
            </div>
            <div className="jevc-run-fact">
              <dt>
                {preview ? "Characters that would go" : "Characters removed"}
              </dt>
              <dd>{group(run.charsSaved)}</dd>
            </div>
            <div className="jevc-run-fact">
              <dt>Jev requests</dt>
              <dd>
                {group(run.batches)}
                <span className="jevc-run-note">
                  {` · at most ${group(run.maxConcurrency)} in flight`}
                </span>
              </dd>
            </div>
            <div className="jevc-run-fact">
              <dt>Context window</dt>
              <dd>
                {run.contextWindow === null
                  ? "unresolved"
                  : group(run.contextWindow)}
              </dd>
            </div>
          </dl>
          <p className="jevc-run-line">
            <span className="jevc-run-key">Trigger</span>
            <span>{run.trigger.replace(/-/g, " ")}</span>
            <span className="jevc-run-key">State stage</span>
            <span>{run.stage.replace(/-/g, " ")}</span>
          </p>
          <ul className="jevc-run-actions">
            <li>
              <span className="jevc-run-chip">KEEP_FULL</span>
              {group(run.actions.KEEP_FULL)}
            </li>
            <li>
              <span className="jevc-run-chip">KEEP_TRUNCATED</span>
              {group(run.actions.KEEP_TRUNCATED)}
            </li>
            <li>
              <span className="jevc-run-chip">KEEP_STUB</span>
              {group(run.actions.KEEP_STUB)}
            </li>
          </ul>
          <table className="jevc-run-items">
            <thead>
              <tr>
                <th scope="col">Tool</th>
                <th scope="col">Chars</th>
                <th scope="col">Decision</th>
                <th scope="col">Original → replacement</th>
                <th scope="col">Scores</th>
              </tr>
            </thead>
            <tbody>
              {run.items.map((item) => (
                <tr key={item.originalSeq}>
                  <td>{item.tool}</td>
                  <td className="jevc-run-num">{group(item.chars)}</td>
                  <td>
                    <span
                      className={`jevc-run-chip jevc-run-chip--${item.action}`}
                    >
                      {item.action}
                    </span>
                  </td>
                  <td className="jevc-run-num">
                    {item.originalSeq}
                    {item.replacementSeq === null
                      ? " → kept"
                      : ` → ${item.replacementSeq}`}
                  </td>
                  <td className="jevc-run-num">
                    {item.needContents === undefined
                      ? "—"
                      : `need ${item.needContents.toFixed(2)}`}
                    {item.needVerbatim === undefined ? null : (
                      <span className="jevc-run-note">
                        {` verbatim ${item.needVerbatim.toFixed(2)}`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="jevc-run-foot">
            Metadata only — this card stores no pruned tool output. The
            originals stay in the append-only session log; the seq pairs above
            address them there.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SkipCard({
  data,
}: {
  data: Extract<JevCompactionChatData, { view: "skip" }>;
}): ReactElement {
  const skip = data.skip;
  return (
    <div className="jevc-run jevc-run--skip">
      <div className="jevc-run-skip-line">
        <span className="jevc-run-title">Jev compaction</span>
        <span className="jevc-run-badge jevc-run-badge--skip">skipped</span>
        <span className="jevc-run-reason">
          {skip.reason.replace(/-/g, " ")}
        </span>
        <span className="jevc-run-time">{clock(data.time)}</span>
      </div>
      {skip.candidates > 0 ? (
        <div className="jevc-run-summary">
          <span>{`${group(skip.candidates)} candidates seen`}</span>
          {skip.tokensBefore !== null ? (
            <>
              <span className="jevc-run-sep">·</span>
              <span>{`${group(skip.tokensBefore)} surface tokens`}</span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Keyed `conversation.chat.node` renderer for the `jev-compaction` kind. */
export function JevCompactionRunCard({ node }: CardProps): ReactElement {
  if (node.data.view === "skip") return <SkipCard data={node.data} />;
  return <RunCard data={node.data} />;
}
