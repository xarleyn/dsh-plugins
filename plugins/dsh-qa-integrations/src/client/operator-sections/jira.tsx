/**
 * The Jira section of the operator card: the sites the deployment reads, the
 * field aliases this instance names its custom fields by, and the budgets of
 * one search or comment page.
 */

import type { ReactElement } from "react";
import { InstanceListField, RecordField } from "../operator-controls.js";
import { ProviderSection, type CapabilitySpec } from "./provider-section.js";
import {
  DEPLOYMENT_OPTIONS,
  instanceRows,
  rawObject,
  rawRecord,
  type OperatorForm,
} from "./shared.js";

const CAPABILITIES: readonly CapabilitySpec[] = [
  { key: "identityRead", label: "Профиль: чтение" },
  { key: "issuesRead", label: "Задачи: чтение" },
  { key: "commentsRead", label: "Комментарии: чтение" },
  { key: "attachmentsRead", label: "Вложения: чтение" },
  { key: "transitionsRead", label: "Переходы: чтение" },
  { key: "projectsRead", label: "Проекты: чтение" },
  { key: "fieldsRead", label: "Схема полей: чтение" },
];

const LIMITS = [
  { key: "defaultSearchLimit", label: "Строк поиска по умолчанию" },
  { key: "maxSearchLimit", label: "Потолок строк поиска" },
  { key: "maxCommentLimit", label: "Потолок страницы комментариев" },
  { key: "maxTextChars", label: "Знаков текста в ответе" },
  { key: "retries", label: "Повторы при 429/5xx" },
];

export function JiraSection({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  const jira = rawObject(form.config.jira);
  return (
    <ProviderSection
      form={form}
      title="Jira"
      provider="jira"
      http={{ hint: "только для dev-стенда" }}
      counts={[{ path: "sites", forms: ["сайт", "сайта", "сайтов"] as const }]}
      capabilities={CAPABILITIES}
      connection={
        <>
          <InstanceListField
            label="Сайты Jira Cloud"
            hint="пользователь выбирает сайт из списка, произвольный хост ввести нельзя"
            path={["jira", "sites"]}
            instances={instanceRows(jira.sites)}
            deployments={DEPLOYMENT_OPTIONS}
            {...form.control}
          />
          <RecordField
            label="Псевдонимы полей"
            hint="имя поля Jira по бизнес-термину"
            path={["jira", "fieldAliases"]}
            entries={rawRecord(jira.fieldAliases)}
            keyPlaceholder="продукт"
            valuePlaceholder="customfield_10000"
            {...form.control}
          />
        </>
      }
      limits={{ fields: LIMITS }}
    />
  );
}
