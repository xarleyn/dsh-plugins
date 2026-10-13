import { useState } from "react";
import type { QaCapabilityDescriptor, QaSkillAccess } from "../../types.js";
import type { CapabilityType } from "./capability-selection.js";

export function CapabilityPicker(props: {
  readonly type: CapabilityType;
  /** The zone this picker is mounted in, so its rows stay addressable. */
  readonly testId?: string;
  readonly catalog: readonly QaCapabilityDescriptor[];
  readonly selected: readonly string[];
  readonly inherited?: readonly string[];
  readonly system?: readonly string[];
  readonly skillDetails?: readonly QaSkillAccess[];
  readonly onChange?: (next: readonly string[]) => void;
}) {
  const zone = props.testId ?? "qa-admin-capabilities";
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const inherited = new Set(props.inherited ?? []);
  const system = new Set(props.system ?? []);
  const selected = new Set(props.selected);
  const rows = props.catalog.filter(
    ({ type, id, title }) =>
      type === props.type &&
      (!selectedOnly ||
        selected.has(id) ||
        inherited.has(id) ||
        system.has(id)) &&
      (query === "" ||
        `${id} ${title}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())),
  );
  const groups = new Map<string, QaCapabilityDescriptor[]>();
  for (const row of rows) {
    const group =
      row.source.name === undefined
        ? row.source.kind
        : `${row.source.kind} · ${row.source.name}`;
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return (
    <div className="dsh-qa-capabilities" data-testid={zone}>
      <div
        className="dsh-qa-capabilities__toolbar"
        data-testid={`${zone}-toolbar`}
      >
        <input
          type="search"
          data-testid={`${zone}-search`}
          value={query}
          placeholder={
            props.type === "tool" ? "Поиск инструментов…" : "Поиск навыков…"
          }
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <label data-testid={`${zone}-selected-only`}>
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(event) => setSelectedOnly(event.currentTarget.checked)}
          />
          Только выбранные
        </label>
      </div>
      {rows.length === 0 ? (
        <p className="dsh-qa-admin__empty" data-testid={`${zone}-empty`}>
          Ничего не найдено.
        </p>
      ) : (
        [...groups].map(([group, entries]) => (
          <section
            key={group}
            className="dsh-qa-capabilities__group"
            data-testid={`${zone}-group`}
          >
            <h4>{group.toLocaleUpperCase()}</h4>
            {entries.map((capability) => {
              const required = system.has(capability.id);
              const common = inherited.has(capability.id);
              const checked = required || common || selected.has(capability.id);
              const skill = props.skillDetails?.find(
                ({ name }) => name === capability.id,
              );
              return (
                <label
                  key={`${capability.type}:${capability.id}`}
                  className="dsh-qa-capability"
                  data-testid={`${zone}-item`}
                  title={
                    required
                      ? "Системная возможность"
                      : common
                        ? "Управляется в общих возможностях"
                        : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      required || common || props.onChange === undefined
                    }
                    onChange={(event) => {
                      const next = new Set(selected);
                      if (event.currentTarget.checked) next.add(capability.id);
                      else next.delete(capability.id);
                      props.onChange?.([...next]);
                    }}
                  />
                  <span
                    className="dsh-qa-capability__copy"
                    data-testid={`${zone}-item-copy`}
                  >
                    <strong>{capability.title}</strong>
                    {capability.description === undefined ? null : (
                      <small>{capability.description}</small>
                    )}
                    {capability.type === "skill" ? (
                      <>
                        <small>
                          Provider:{" "}
                          {capability.source.name ?? capability.source.kind}
                          {capability.modelInvocable === false
                            ? " · только вручную"
                            : " · доступен модели"}
                        </small>
                        {skill === undefined ? null : (
                          <small>
                            {skill.descriptor.requiredTools.length === 0
                              ? "Не выдаёт инструменты"
                              : `Выдаёт при активации: ${skill.descriptor.requiredTools.join(", ")}`}
                          </small>
                        )}
                      </>
                    ) : null}
                  </span>
                  {required ? (
                    <em data-testid={`${zone}-item-system`}>Системное</em>
                  ) : common ? (
                    <em data-testid={`${zone}-item-common`}>Общее</em>
                  ) : capability.type === "skill" &&
                    selected.has(capability.id) ? (
                    <em data-testid={`${zone}-item-admin`}>Администратор</em>
                  ) : null}
                  {capability.status === "missing" ? (
                    <em
                      className="dsh-qa-capability__missing"
                      data-testid={`${zone}-item-missing`}
                    >
                      Не установлен
                    </em>
                  ) : null}
                </label>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
