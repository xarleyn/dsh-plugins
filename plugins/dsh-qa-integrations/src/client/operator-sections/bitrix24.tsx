/**
 * The Bitrix24 section of the operator card: portals are addressed by the
 * webhook's own host, checked against `allowedPortalSuffixes` in the general
 * section, so this provider has no address list and no tuning knobs of its
 * own — a switch and the surface it opens to the agent.
 */

import type { ReactElement } from "react";
import { ProviderSection, type CapabilitySpec } from "./provider-section.js";
import type { OperatorForm } from "./shared.js";

const CAPABILITIES: readonly CapabilitySpec[] = [
  { key: "crmRead", label: "CRM: чтение" },
  {
    key: "crmCommentWrite",
    label: "CRM: комментарий таймлайна (запись)",
    on: false,
    hint: "единственный инструмент записи; выключен по умолчанию",
  },
  { key: "chatRead", label: "Чаты: чтение" },
  { key: "openlinesRead", label: "Открытые линии: чтение" },
  { key: "userRead", label: "Пользователи: чтение" },
  { key: "departmentRead", label: "Структура компании: чтение" },
  { key: "tasksRead", label: "Задачи: чтение" },
  { key: "calendarRead", label: "Календарь: чтение" },
  { key: "diskRead", label: "Диск: чтение" },
];

export function Bitrix24Section({
  form,
}: {
  readonly form: OperatorForm;
}): ReactElement {
  return (
    <ProviderSection
      form={form}
      title="Bitrix24"
      provider="bitrix24"
      capabilities={CAPABILITIES}
    />
  );
}
