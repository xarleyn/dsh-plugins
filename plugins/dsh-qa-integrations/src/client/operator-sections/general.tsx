/**
 * The general section of the operator card: the plugin switch, the storage
 * files the host re-opens on restart, the portal domains Bitrix24 webhooks
 * may name, and the deployment-wide budgets every provider reads through.
 */

import type { ReactElement } from "react";
import {
  NumberField,
  StringListField,
  TextField,
} from "../operator-controls.js";
import {
  Group,
  LimitsGroup,
  rawBool,
  rawNumber,
  rawString,
  rawStringList,
  Section,
  type OperatorForm,
} from "./shared.js";

export function GeneralSection({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  const { config, control } = form;
  return (
    <Section title="Общие" open>
      <Group title="Плагин">
        {form.toggle(
          "Плагин включён",
          ["enabled"],
          rawBool(config.enabled, false),
          "выключенный плагин не регистрирует инструменты и прячет пользовательские страницы",
        )}
      </Group>
      <Group
        title="Хранилище и ключи"
        wide
        hint="пути читаются хостом при старте: правка действует со следующего рестарта"
      >
        <TextField
          label="Файл хранилища подключений"
          hint="применяется со следующим рестартом хоста"
          path={["dataPath"]}
          value={rawString(config.dataPath)}
          {...control}
        />
        <TextField
          label="Файл мастер-ключа"
          hint="применяется со следующим рестартом хоста"
          path={["masterKeyPath"]}
          value={rawString(config.masterKeyPath)}
          {...control}
        />
        <NumberField
          label="Версия мастер-ключа"
          path={["masterKeyVersion"]}
          value={rawNumber(config.masterKeyVersion)}
          {...control}
        />
      </Group>
      <Group title="Домены подключений">
        <StringListField
          label="Суффиксы порталов Bitrix24"
          hint="хосты, на которые может указывать вебхук; каждый с точки"
          path={["allowedPortalSuffixes"]}
          values={rawStringList(config.allowedPortalSuffixes)}
          placeholder=".bitrix24.example"
          {...control}
        />
      </Group>
      <LimitsGroup hint="потолки ответов провайдеров и срок хранения аудита">
        <NumberField
          label="Таймаут запроса, мс"
          path={["timeoutMs"]}
          value={rawNumber(config.timeoutMs)}
          {...control}
        />
        <NumberField
          label="Потолок ответа провайдера, байт"
          path={["maxResponseBytes"]}
          value={rawNumber(config.maxResponseBytes)}
          {...control}
        />
        <NumberField
          label="Хранение аудита, дней"
          path={["auditRetentionDays"]}
          value={rawNumber(config.auditRetentionDays)}
          {...control}
        />
      </LimitsGroup>
    </Section>
  );
}
