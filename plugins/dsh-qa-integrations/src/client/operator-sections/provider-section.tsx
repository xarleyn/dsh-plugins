/**
 * The provider section form, rendered once. Every provider section is the same
 * shape — a switch for the provider, the optional plain-HTTP exception, the
 * connections it reads through, the checklist of what the agent may touch, and
 * the tuning knobs folded away — and only the data differs. A new provider
 * declares its spec here; it does not copy this form.
 */

import type { ReactElement, ReactNode } from "react";
import { NumberField } from "../operator-controls.js";
import {
  Group,
  LimitsGroup,
  providerState,
  rawBool,
  rawNumber,
  rawObject,
  readPath,
  Section,
  type OperatorForm,
} from "./shared.js";

/** One capability: its config key, its label, and how its switch defaults. */
export interface CapabilitySpec {
  readonly key: string;
  readonly label: string;
  /** Whether the switch reads on when the layer names nothing; default on. */
  readonly on?: boolean;
  readonly hint?: string;
}

/** One numeric tuning knob under `[provider, key]`. */
export interface LimitFieldSpec {
  readonly key: string;
  readonly label: string;
}

export interface ProviderSectionProps {
  readonly form: OperatorForm;
  /** The section heading, as the operator reads it. */
  readonly title: string;
  /** The provider's key in the config namespace. */
  readonly provider: string;
  readonly capabilities: readonly CapabilitySpec[];
  /**
   * The plain-HTTP exception the provider offers, with its path when the
   * switch does not live at `<provider>.allowInsecureHttp`. Absent for a
   * provider whose address the operator declares in one place.
   */
  readonly http?: { readonly path?: readonly string[]; readonly hint?: string };
  /** List-valued connection fields the collapsed line counts. */
  readonly counts?: readonly {
    readonly path: string;
    readonly forms: readonly [string, string, string];
  }[];
  /** The connection editors, mounted in a wide group when present. */
  readonly connection?: ReactNode;
  /** The numeric knobs, folded into the limits drawer; absent when none. */
  readonly limits?: {
    readonly hint?: string;
    readonly fields: readonly LimitFieldSpec[];
  };
}

export function ProviderSection(props: ProviderSectionProps): ReactElement {
  const { form, provider } = props;
  // The provider is the test id zone: every hook of this section is named
  // `qa-integrations-<provider>-<part>`, so a test reaches a knob without
  // reading the Russian caption that describes it.
  const zone = `qa-integrations-${provider}`;
  const record = rawObject(form.config[provider]);
  const httpPath = props.http?.path ?? [provider, "allowInsecureHttp"];
  return (
    <Section
      testId={zone}
      title={props.title}
      state={providerState(record, {
        enabled: true,
        capabilities: props.capabilities.map((cap) => [
          cap.key,
          cap.on !== false,
        ]),
        counts: props.counts,
      })}
    >
      <Group testId={`${zone}-provider`} title="Провайдер">
        {form.toggle(
          "Провайдер включён",
          [provider, "enabled"],
          rawBool(record.enabled, true),
        )}
        {props.http === undefined ? null : (
          <>
            {form.toggle(
              "Разрешить http",
              httpPath,
              rawBool(readPath(form.config, httpPath), false),
              props.http.hint,
            )}
          </>
        )}
      </Group>
      {props.connection === undefined || props.connection === null ? null : (
        <Group testId={`${zone}-connection`} title="Подключение" wide>
          {props.connection}
        </Group>
      )}
      <Group
        testId={`${zone}-capabilities`}
        title="Что доступно агенту"
        kind="checks"
      >
        {props.capabilities.map((cap) =>
          form.toggle(
            cap.label,
            [provider, cap.key],
            rawBool(record[cap.key], cap.on !== false),
            cap.hint,
          ),
        )}
      </Group>
      {props.limits === undefined ? null : (
        <LimitsGroup testId={`${zone}-limits`} hint={props.limits.hint}>
          {props.limits.fields.map((field) => (
            <NumberField
              key={field.key}
              label={field.label}
              path={[provider, field.key]}
              value={rawNumber(record[field.key])}
              {...form.control}
            />
          ))}
        </LimitsGroup>
      )}
    </Section>
  );
}
