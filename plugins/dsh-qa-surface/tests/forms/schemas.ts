import type { QaFormSchema } from "../../src/forms/types.js";

/**
 * Synthetic form fixtures, kept apart from the sqlite fixture so client
 * component tests can import a schema without dragging the durable store —
 * and its sqlite bridge — into a browser test environment.
 */

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
