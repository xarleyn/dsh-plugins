/**
 * The Weblate section of the operator card: the instances the deployment reads
 * and the budgets of one translated-string page.
 */

import type { ReactElement } from "react";
import { InstanceListField } from "../operator-controls.js";
import { ProviderSection, type CapabilitySpec } from "./provider-section.js";
import { instanceRows, rawObject, type OperatorForm } from "./shared.js";

const CAPABILITIES: readonly CapabilitySpec[] = [
  { key: "identityRead", label: "Профиль: чтение" },
  { key: "projectsRead", label: "Проекты: чтение" },
  { key: "componentsRead", label: "Компоненты: чтение" },
  { key: "translationsRead", label: "Переводы: чтение" },
  { key: "unitsRead", label: "Единицы: чтение" },
  { key: "checksRead", label: "Проверки: чтение" },
  { key: "commentsRead", label: "Комментарии: чтение" },
  { key: "suggestionsRead", label: "Предложения: чтение" },
  { key: "changesRead", label: "Изменения: чтение" },
  { key: "statisticsRead", label: "Статистика: чтение" },
  { key: "screenshotsRead", label: "Скриншоты: чтение" },
];

const LIMITS = [
  { key: "maxTextChars", label: "Знаков строки в ответе" },
  { key: "maxPageSize", label: "Строк на страницу" },
  { key: "retries", label: "Повторы при 429/5xx" },
];

export function WeblateSection({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  const weblate = rawObject(form.config.weblate);
  return (
    <ProviderSection
      form={form}
      title="Weblate"
      provider="weblate"
      http={{ hint: "только для dev-стенда" }}
      counts={[
        {
          path: "instances",
          forms: ["инстанс", "инстанса", "инстансов"] as const,
        },
      ]}
      capabilities={CAPABILITIES}
      connection={
        <InstanceListField
          label="Инстансы Weblate"
          path={["weblate", "instances"]}
          instances={instanceRows(weblate.instances)}
          {...form.control}
        />
      }
      limits={{ fields: LIMITS }}
    />
  );
}
