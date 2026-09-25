/**
 * The GitLab section of the operator card: the instances the deployment reads,
 * the surface the agent may touch, and the byte budgets of file and job-log
 * reads. CI is one switch here: the Host resolver splits it into the metadata
 * and log halves of earlier releases.
 */

import type { ReactElement } from "react";
import { InstanceListField } from "../operator-controls.js";
import { ProviderSection, type CapabilitySpec } from "./provider-section.js";
import { instanceRows, rawObject, type OperatorForm } from "./shared.js";

const CAPABILITIES: readonly CapabilitySpec[] = [
  { key: "identityRead", label: "Профиль: чтение" },
  { key: "projectsRead", label: "Проекты: чтение" },
  { key: "repositoryRead", label: "Репозиторий: чтение" },
  { key: "searchRead", label: "Поиск: чтение" },
  { key: "issuesRead", label: "Задачи: чтение" },
  { key: "mergeRequestsRead", label: "MR: чтение" },
  { key: "ciRead", label: "CI: чтение" },
];

const LIMITS = [
  { key: "maxFileBytes", label: "Потолок файла, байт" },
  { key: "maxJobLogBytes", label: "Потолок лога задачи CI, байт" },
  { key: "maxSearchResults", label: "Потолок результатов поиска" },
  { key: "retries", label: "Повторы при 429/5xx" },
];

export function GitlabSection({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  const gitlab = rawObject(form.config.gitlab);
  return (
    <ProviderSection
      form={form}
      title="GitLab"
      provider="gitlab"
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
          label="Инстансы GitLab"
          hint="пользователь выбирает инстанс из списка, произвольный хост ввести нельзя"
          path={["gitlab", "instances"]}
          instances={instanceRows(gitlab.instances)}
          {...form.control}
        />
      }
      limits={{ fields: LIMITS }}
    />
  );
}
