import type {
  ResolvedExpertProfile,
  ResolvedMemoryEntry,
  ResolvedResourceEntry,
} from "../types.js";
import { EnforcementChip, Section } from "./components.js";

const CLASS_LABEL: Record<ResolvedResourceEntry["class"], string> = {
  primary: "primary",
  shared: "shared",
  denied: "denied",
};

/**
 * Resolved scope inspector (design §27).
 *
 * The point of this screen is the distinction between a restriction that is
 * applied and one that is only stated to the model, so the enforcement chip is
 * rendered for every resource, memory namespace and delegation target —
 * `advisory` is never hidden or styled as success.
 */
export function ScopeInspector({
  profile,
}: {
  readonly profile: ResolvedExpertProfile;
}) {
  return (
    <div className="dx-panel" data-testid="domain-experts-inspector-root">
      <div className="dx-section" data-testid="domain-experts-inspector-header">
        <h3
          className="dx-section-title"
          data-testid="domain-experts-inspector-title"
        >
          Resolved scope — {profile.name}
        </h3>
        <p
          className="dx-section-note"
          data-testid="domain-experts-inspector-note"
        >
          Depth budget {String(profile.depthBudget)}; resolved at{" "}
          {new Date(profile.resolvedAt).toLocaleTimeString()}.
        </p>
      </div>

      <Section
        title="Resources"
        note="Enforced means a selected worker actually applies the restriction. Advisory means it is only written into the expert's persona."
        testId="domain-experts-inspector-resources"
      >
        {profile.resources.length === 0 ? (
          <p
            className="dx-empty"
            data-testid="domain-experts-inspector-resources-empty"
          >
            No filesystem or knowledge resources configured.
          </p>
        ) : (
          <table
            className="dx-table"
            data-testid="domain-experts-inspector-resources-table"
          >
            <thead>
              <tr>
                <th>Path</th>
                <th>Class</th>
                <th>Enforcement</th>
                <th>Applied by</th>
              </tr>
            </thead>
            <tbody>
              {profile.resources.map((resource) => (
                <tr
                  key={`${resource.provider}:${resource.class}:${resource.path}`}
                  data-testid="domain-experts-inspector-resource"
                >
                  <td
                    className="dx-mono"
                    data-testid="domain-experts-inspector-resource-path"
                  >
                    {resource.path}
                  </td>
                  <td data-testid="domain-experts-inspector-resource-class">
                    {CLASS_LABEL[resource.class]}
                  </td>
                  <td>
                    <EnforcementChip
                      enforcement={resource.enforcement}
                      testId="domain-experts-inspector-resource-enforcement"
                    />
                  </td>
                  <td
                    className="dx-mono"
                    data-testid="domain-experts-inspector-resource-applied-by"
                  >
                    {resource.enforcedBy.length === 0
                      ? "—"
                      : resource.enforcedBy.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="Memory"
        note="What an expert may read and write, namespace by namespace. An account-scoped deployment records each account's notes under the domain namespace and reads the domain namespace itself as the common tier."
        testId="domain-experts-inspector-memory"
      >
        <table
          className="dx-table"
          data-testid="domain-experts-inspector-memory-table"
        >
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Access</th>
              <th>Enforcement</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {profile.memory.map((entry) => (
              <tr
                key={entry.namespace}
                data-testid="domain-experts-inspector-memory-entry"
              >
                <td
                  className="dx-mono"
                  data-testid="domain-experts-inspector-memory-entry-namespace"
                >
                  {entry.namespace}
                </td>
                <td data-testid="domain-experts-inspector-memory-entry-access">
                  {memoryAccessLabel(entry)}
                </td>
                <td>
                  <EnforcementChip
                    enforcement={entry.enforcement}
                    testId="domain-experts-inspector-memory-entry-enforcement"
                  />
                </td>
                <td data-testid="domain-experts-inspector-memory-entry-note">
                  {entry.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Tools visible to the expert"
        testId="domain-experts-inspector-tools"
      >
        <table
          className="dx-table"
          data-testid="domain-experts-inspector-tools-table"
        >
          <thead>
            <tr>
              <th>Tool</th>
              <th>Kind</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {profile.tools.map((tool) => (
              <tr key={tool.name} data-testid="domain-experts-inspector-tool">
                <td
                  className="dx-mono"
                  data-testid="domain-experts-inspector-tool-name"
                >
                  {tool.name}
                </td>
                <td data-testid="domain-experts-inspector-tool-kind">
                  {tool.kind}
                </td>
                <td data-testid="domain-experts-inspector-tool-note">
                  {tool.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Cross-domain"
        testId="domain-experts-inspector-cross-domain"
      >
        <p
          className="dx-section-note"
          data-testid="domain-experts-inspector-delegation-summary"
        >
          Mode <strong>{profile.delegation.mode}</strong>; depth cap{" "}
          {String(profile.delegation.maxDepth)}; parallel experts{" "}
          {String(profile.delegation.maxParallel)}.
        </p>
        {profile.delegation.peers.length === 0 ? (
          <p
            className="dx-empty"
            data-testid="domain-experts-inspector-peers-empty"
          >
            No other enabled domain is reachable under this policy.
          </p>
        ) : (
          <table
            className="dx-table"
            data-testid="domain-experts-inspector-peers-table"
          >
            <thead>
              <tr>
                <th>Domain</th>
                <th>Mode</th>
                <th>Allowed</th>
              </tr>
            </thead>
            <tbody>
              {profile.delegation.peers.map((peer) => (
                <tr
                  key={peer.domainId}
                  data-testid="domain-experts-inspector-peer"
                >
                  <td
                    className="dx-mono"
                    data-testid="domain-experts-inspector-peer-domain"
                  >
                    {peer.domainId}
                  </td>
                  <td data-testid="domain-experts-inspector-peer-mode">
                    {peer.mode}
                  </td>
                  <td data-testid="domain-experts-inspector-peer-allowed">
                    {peer.allowed ? "yes" : "no"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {profile.providers.length > 0 ? (
        <Section
          title="Scope providers"
          testId="domain-experts-inspector-providers"
        >
          <table
            className="dx-table"
            data-testid="domain-experts-inspector-providers-table"
          >
            <thead>
              <tr>
                <th>Provider</th>
                <th>Registered</th>
                <th>Enforcement</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {profile.providers.map((provider) => (
                <tr
                  key={provider.id}
                  data-testid="domain-experts-inspector-provider"
                >
                  <td
                    className="dx-mono"
                    data-testid="domain-experts-inspector-provider-id"
                  >
                    {provider.id}
                  </td>
                  <td data-testid="domain-experts-inspector-provider-registered">
                    {provider.registered ? "yes" : "no"}
                  </td>
                  <td>
                    <EnforcementChip
                      enforcement={provider.enforcement}
                      testId="domain-experts-inspector-provider-enforcement"
                    />
                  </td>
                  <td data-testid="domain-experts-inspector-provider-note">
                    {provider.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {profile.degradations.length > 0 ? (
        <Section
          title="Degraded configuration"
          testId="domain-experts-inspector-degraded"
        >
          <ul
            className="dx-issues"
            data-testid="domain-experts-inspector-degradations"
          >
            {profile.degradations.map((item, index) => (
              <li
                className="dx-issue dx-issue--warning"
                key={`${item.code}-${String(index)}`}
                data-testid="domain-experts-inspector-degradation"
              >
                <strong data-testid="domain-experts-inspector-degradation-code">
                  {item.code}
                </strong>{" "}
                {item.message}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function memoryAccessLabel(entry: ResolvedMemoryEntry): string {
  return entry.access === "read-write" ? "read/write" : "read-only";
}
