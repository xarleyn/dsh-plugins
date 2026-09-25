/**
 * The Test IT section of the operator card: the installations the deployment
 * reads and the budgets of one list page or attachment read.
 */

import type { ReactElement } from "react";
import { InstanceListField } from "../operator-controls.js";
import { ProviderSection, type CapabilitySpec } from "./provider-section.js";
import { instanceRows, rawObject, type OperatorForm } from "./shared.js";

const CAPABILITIES: readonly CapabilitySpec[] = [
  { key: "projectsRead", label: "Проекты: чтение" },
  { key: "sectionsRead", label: "Секции: чтение" },
  { key: "workItemsRead", label: "Work items: чтение" },
  { key: "historyRead", label: "История: чтение" },
  { key: "commentsRead", label: "Комментарии: чтение" },
  { key: "testPlansRead", label: "Планы: чтение" },
  { key: "testRunsRead", label: "Прогоны: чтение" },
  { key: "testResultsRead", label: "Результаты: чтение" },
  { key: "autoTestsRead", label: "Автотесты: чтение" },
  { key: "attachmentsRead", label: "Вложения: чтение" },
  { key: "configurationsRead", label: "Конфигурации: чтение" },
];

const LIMITS = [
  { key: "defaultResults", label: "Строк по умолчанию" },
  { key: "maxResults", label: "Потолок строк списка" },
  { key: "defaultAttachmentBytes", label: "Вложение по умолчанию, байт" },
  { key: "maxAttachmentBytes", label: "Потолок вложения, байт" },
  { key: "attachmentTimeoutMs", label: "Таймаут вложения, мс" },
  { key: "retries", label: "Повторы при 429/5xx" },
];

export function TestitSection({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  const testit = rawObject(form.config.testit);
  return (
    <ProviderSection
      form={form}
      title="Test IT"
      provider="testit"
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
          label="Инсталляции Test IT"
          path={["testit", "instances"]}
          instances={instanceRows(testit.instances)}
          {...form.control}
        />
      }
      limits={{ fields: LIMITS }}
    />
  );
}
