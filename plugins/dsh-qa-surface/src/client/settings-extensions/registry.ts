import type {
  QaUserSettingsSectionRegistration,
  QaUserSettingsSections,
  QaUserSettingsSectionsSnapshot,
} from "./contract.js";

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > 80) {
    throw new Error(
      `qaUserSettingsSections.register: ${field} must not be empty`,
    );
  }
  return normalized;
}

/** Deterministic, observable registry backing the settings extension service. */
export class QaUserSettingsSectionRegistry implements QaUserSettingsSections {
  private readonly entries = new Map<
    string,
    QaUserSettingsSectionRegistration
  >();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private disposed = false;
  private snapshot: QaUserSettingsSectionsSnapshot = {
    sections: Object.freeze([]),
    revision: 0,
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): QaUserSettingsSectionsSnapshot => this.snapshot;

  register(section: QaUserSettingsSectionRegistration): () => void {
    if (this.disposed) {
      throw new Error(
        "qaUserSettingsSections.register: registry has been disposed",
      );
    }
    const id = requireIdentifier(section.id, "id");
    const title = requireIdentifier(section.title, "title");
    if (this.entries.has(id)) {
      throw new Error(`qaUserSettingsSections.register: duplicate id "${id}"`);
    }
    const normalized = Object.freeze({ ...section, id, title });
    this.entries.set(id, normalized);
    this.publish();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.entries.delete(id);
      this.publish();
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.entries.clear();
    this.publish();
    this.listeners.clear();
  }

  private publish(): void {
    this.revision += 1;
    this.snapshot = Object.freeze({
      sections: Object.freeze(
        [...this.entries.values()].sort(
          (left, right) =>
            (left.order ?? 0) - (right.order ?? 0) ||
            left.id.localeCompare(right.id),
        ),
      ),
      revision: this.revision,
    });
    for (const listener of this.listeners) listener();
  }
}
