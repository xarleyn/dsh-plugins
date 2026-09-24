/**
 * The TeamCity section of the operator card: one server address for the whole
 * stand and the network policy that admits it, so the plain-HTTP exception
 * lives inside `network`, not beside the provider switch.
 */

import type { ReactElement } from "react";
import {
  SelectField,
  StringListField,
  TextField,
} from "../operator-controls.js";
import { ProviderSection, type CapabilitySpec } from "./provider-section.js";
import {
  rawObject,
  rawString,
  rawStringList,
  type OperatorForm,
} from "./shared.js";

const CAPABILITIES: readonly CapabilitySpec[] = [
  { key: "identityRead", label: "Профиль: чтение" },
  { key: "projectsRead", label: "Проекты: чтение" },
  { key: "buildConfigsRead", label: "Конфигурации сборок: чтение" },
  { key: "buildsRead", label: "Сборки: чтение" },
  { key: "failuresRead", label: "Провалы: чтение" },
  { key: "logsRead", label: "Логи сборок: чтение" },
  { key: "queueRead", label: "Очередь: чтение" },
  { key: "investigationsRead", label: "Расследования: чтение" },
  { key: "agentsRead", label: "Агенты: чтение" },
  { key: "artifactsRead", label: "Артефакты: чтение" },
];

const LIMITS = [
  { key: "maxLogLines", label: "Строк в ответе лога" },
  { key: "maxLogBytes", label: "Скачивать лога, байт" },
  { key: "defaultArtifactBytes", label: "Артефакт по умолчанию, байт" },
  { key: "maxArtifactBytes", label: "Потолок артефакта, байт" },
  { key: "streamTimeoutMs", label: "Таймаут логов и артефактов, мс" },
  { key: "retries", label: "Повторы при 429/5xx" },
];

export function TeamcitySection({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  const teamcity = rawObject(form.config.teamcity);
  const network = rawObject(teamcity.network);
  return (
    <ProviderSection
      form={form}
      title="TeamCity"
      provider="teamcity"
      http={{
        path: ["teamcity", "network", "allowHttp"],
        hint: "незащищённые адреса TeamCity",
      }}
      capabilities={CAPABILITIES}
      connection={
        <>
          <TextField
            label="Адрес сервера TeamCity"
            hint="один на весь стенд; пользователь вводит только токен"
            placeholder="https://teamcity.example.corp"
            path={["teamcity", "serverUrl"]}
            value={rawString(teamcity.serverUrl)}
            {...form.control}
          />
          <SelectField
            label="Режим сетевой политики"
            path={["teamcity", "network", "mode"]}
            value={rawString(network.mode) || "allowlist"}
            options={[
              {
                value: "allowlist",
                label: "allowlist — только перечисленные адреса",
              },
              {
                value: "trusted-private",
                label:
                  "trusted-private — любой хост, приватные диапазоны разрешены",
              },
            ]}
            disabled={form.control.disabled}
            write={form.control.write}
            overridden={form.control.overridden}
          />
          <StringListField
            label="Разрешённые хосты"
            hint="точные имена или *.суффикс; опечатка падает при записи"
            path={["teamcity", "network", "allowedHosts"]}
            values={rawStringList(network.allowedHosts)}
            placeholder="teamcity.example.corp"
            {...form.control}
          />
          <StringListField
            label="Разрешённые CIDR"
            hint="только для адресов, записанных цифрами"
            path={["teamcity", "network", "allowedCidrs"]}
            values={rawStringList(network.allowedCidrs)}
            placeholder="10.20.0.0/16"
            {...form.control}
          />
          <StringListField
            label="Разрешённые порты"
            hint="пусто — только порт схемы"
            path={["teamcity", "network", "allowedPorts"]}
            values={rawStringList(network.allowedPorts)}
            placeholder="8111"
            {...form.control}
          />
        </>
      }
      limits={{ fields: LIMITS }}
    />
  );
}
