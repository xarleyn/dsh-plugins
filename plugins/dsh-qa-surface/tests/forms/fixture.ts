import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { QaFormStore } from "../../src/forms/store.js";
import { QaFormService } from "../../src/forms/service.js";
import { DEFAULT_FORM_POLICY } from "../../src/forms/schema.js";
import type {
  QaFormCommand,
  QaFormPolicy,
  QaFormSchema,
} from "../../src/forms/types.js";

/** Synthetic intake: three required items and precisely one optional item. */
export const intake: QaFormSchema = {
  schema_version: 1,
  title: "Исходные данные для предложения",
  steps: [
    {
      id: "requirements",
      title: "Требования",
      items: [
        {
          id: "task",
          title: "Задача и техническое задание",
          answer: {
            type: "textarea",
            required: true,
            min_length: 1,
            max_length: 10000,
          },
          files: {
            requirement: "required",
            min_count: 1,
            max_count: 3,
            accept: [".txt", ".pdf", ".docx"],
            max_file_size_bytes: 52428800,
          },
        },
        {
          id: "additional",
          title: "Дополнительные материалы",
          files: {
            requirement: "optional",
            max_count: 5,
            accept: [".txt"],
            max_file_size_bytes: 52428800,
          },
        },
      ],
    },
    {
      id: "scope",
      title: "Состав решения",
      items: [
        {
          id: "modules",
          title: "Модули",
          answer: {
            type: "multi_select",
            required: true,
            min_selected: 1,
            max_selected: 2,
            options: [
              { value: "alpha", label: "Модуль А" },
              { value: "beta", label: "Модуль Б" },
            ],
          },
          files: { requirement: "none" },
        },
        {
          id: "equipment",
          title: "Перечень оборудования",
          files: {
            requirement: "required",
            min_count: 1,
            max_count: 1,
            accept: [".csv", ".xlsx"],
            max_file_size_bytes: 52428800,
          },
        },
      ],
    },
  ],
};
export const textOnly: QaFormSchema = {
  schema_version: 1,
  title: "Вопросы",
  steps: [
    {
      id: "first",
      title: "Данные",
      items: [
        {
          id: "answer",
          title: "Задача",
          answer: { type: "text", required: true },
          files: { requirement: "none" },
        },
      ],
    },
  ],
};
export function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-forms-")),
    file = path.join(dir, "forms.db");
  let store = new QaFormStore(file);
  let policy: QaFormPolicy = { ...DEFAULT_FORM_POLICY, enabled: true };
  const service = () => new QaFormService(store, () => policy);
  let seq = 0;
  return {
    dir,
    file,
    get store() {
      return store;
    },
    get service() {
      return service();
    },
    policy: (next: Partial<QaFormPolicy>) => {
      policy = { ...policy, ...next };
    },
    command(id: string, op: Record<string, unknown>, session = "chat-a") {
      return service().command(session, {
        ...op,
        form_id: id,
        expected_revision: store.get(session, id).revision,
        mutation_id: `mutation_${++seq}`,
      } as QaFormCommand);
    },
    restart() {
      store.close();
      store = new QaFormStore(file);
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
