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
export function ScopeInspector({ profile }: { readonly profile: ResolvedExpertProfile }) {
  return (
    <div className="dx-panel">
      <div className="dx-section">
        <h3 className="dx-section-title">Resolved scope — {profile.name}</h3>
        <p className="dx-section-note">
          Depth budget {String(profile.depthBudget)}; resolved at{" "}
          {new Date(profile.resolvedAt).toLocaleTimeString()}.
        </p>
      </div>

      <Section
        title="Resources"
        note="Enforced means a selected worker actually applies the restriction. Advisory means it is only written into the expert's persona."
      >
        {profile.resources.length === 0 ? (
          <p className="dx-empty">No filesystem or knowledge resources configured.</p>
        ) : (
          <table className="dx-table">
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
                <tr key={`${resource.provider}:${resource.class}:${resource.path}`}>
                  <td className="dx-mono">{resource.path}</td>
                  <td>{CLASS_LABEL[resource.class]}</td>
                  <td>
                    <EnforcementChip enforcement={resource.enforcement} />
                  </td>
                  <td className="dx-mono">
                    {resource.enforcedBy.length === 0 ? "—" : resource.enforcedBy.join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Memory">
        <table className="dx-table">
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Access</th>
              <th>Enforcement</th>
            </tr>
          </thead>
          <tbody>
            {profile.memory.map((entry) => (
              <tr key={entry.namespace}>
                <td className="dx-mono">{entry.namespace}</td>
                <td>{memoryAccessLabel(entry)}</td>
                <td>
                  <EnforcementChip enforcement={entry.enforcement} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Tools visible to the expert">
        <table className="dx-table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Kind</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {profile.tools.map((tool) => (
              <tr key={tool.name}>
                <td className="dx-mono">{tool.name}</td>
                <td>{tool.kind}</td>
                <td>{tool.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Cross-domain">
        <p className="dx-section-note">
          Mode <strong>{profile.delegation.mode}</strong>; depth cap{" "}
          {String(profile.delegation.maxDepth)}; parallel experts{" "}
          {String(profile.delegation.maxParallel)}.
        </p>
        {profile.delegation.peers.length === 0 ? (
          <p className="dx-empty">No other enabled domain is reachable under this policy.</p>
        ) : (
          <table className="dx-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Mode</th>
                <th>Allowed</th>
              </tr>
            </thead>
            <tbody>
              {profile.delegation.peers.map((peer) => (
                <tr key={peer.domainId}>
                  <td className="dx-mono">{peer.domainId}</td>
                  <td>{peer.mode}</td>
                  <td>{peer.allowed ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {profile.providers.length > 0 ? (
        <Section title="Scope providers">
          <table className="dx-table">
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
                <tr key={provider.id}>
                  <td className="dx-mono">{provider.id}</td>
                  <td>{provider.registered ? "yes" : "no"}</td>
                  <td>
                    <EnforcementChip enforcement={provider.enforcement} />
                  </td>
                  <td>{provider.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      {profile.degradations.length > 0 ? (
        <Section title="Degraded configuration">
          <ul className="dx-issues">
            {profile.degradations.map((item, index) => (
              <li className="dx-issue dx-issue--warning" key={`${item.code}-${String(index)}`}>
                <strong>{item.code}</strong> {item.message}
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
