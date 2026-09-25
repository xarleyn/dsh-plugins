/**
 * The Confluence section of the operator card: the sites the deployment reads,
 * the spaces the allowlist admits, and the page surface the agent may touch.
 */

import type { ReactElement } from "react";
import { InstanceListField, StringListField } from "../operator-controls.js";
import { ProviderSection, type CapabilitySpec } from "./provider-section.js";
import {
  DEPLOYMENT_OPTIONS,
  instanceRows,
  rawObject,
  rawStringList,
  type OperatorForm,
} from "./shared.js";

const CAPABILITIES: readonly CapabilitySpec[] = [
  { key: "identityRead", label: "Профиль: чтение" },
  { key: "spacesRead", label: "Пространства: чтение" },
  { key: "searchRead", label: "Поиск: чтение" },
  { key: "contentRead", label: "Страницы: чтение" },
  { key: "commentsRead", label: "Комментарии: чтение" },
  { key: "attachmentsRead", label: "Вложения: чтение" },
  { key: "versionsRead", label: "Версии: чтение" },
];

const LIMITS = [
  { key: "defaultBodyChars", label: "Тело страницы по умолчанию, знаков" },
  { key: "maxBodyChars", label: "Потолок тела страницы, знаков" },
  { key: "maxResults", label: "Строк на страницу списка" },
  { key: "maxReplyParents", label: "Родителей комментариев на вызов" },
  { key: "retries", label: "Повторы при 429/5xx" },
];

export function ConfluenceSection({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  const confluence = rawObject(form.config.confluence);
  return (
    <ProviderSection
      form={form}
      title="Confluence"
      provider="confluence"
      http={{ hint: "только для dev-стенда" }}
      counts={[
        { path: "instances", forms: ["сайт", "сайта", "сайтов"] as const },
      ]}
      capabilities={CAPABILITIES}
      connection={
        <>
          <InstanceListField
            label="Сайты Confluence"
            hint="пользователь выбирает сайт из списка и вводит e-mail с токеном"
            path={["confluence", "instances"]}
            instances={instanceRows(confluence.instances)}
            deployments={DEPLOYMENT_OPTIONS}
            {...form.control}
          />
          <StringListField
            label="Разрешённые пространства"
            hint="пусто — все пространства, доступные подключённому аккаунту"
            path={["confluence", "allowedSpaces"]}
            values={rawStringList(confluence.allowedSpaces)}
            placeholder="PROJ"
            {...form.control}
          />
        </>
      }
      limits={{ fields: LIMITS }}
    />
  );
}
