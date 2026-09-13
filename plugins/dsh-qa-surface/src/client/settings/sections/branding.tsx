/**
 * Branding: pure copy the visitor reads, so nothing here constrains what the
 * Host accepts — every field is free-form and safe to leave empty.
 */

import { Notice, Section, TextField } from "../fields.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

/** Titles, welcome copy, and the notice under the composer. */
export function BrandingSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const paths: SectionPaths = [["branding"]];
  const modified = overriddenAny(props, paths);
  return (
    <Section
      title="Оформление"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <div className="qa-card-grid">
        <TextField
          label="Название"
          value={config?.branding?.title ?? ""}
          disabled={disabled}
          placeholder="Помощник"
          hint="Заголовок на странице и в истории браузера."
          onChange={(value) => {
            props.write(["branding", "title"], value);
          }}
        />
        <TextField
          label="Подзаголовок"
          value={config?.branding?.subtitle ?? ""}
          disabled={disabled}
          hint="Строка под названием; пусто — без подзаголовка."
          onChange={(value) => {
            props.write(["branding", "subtitle"], value);
          }}
        />
        <TextField
          label="Приветствие"
          value={config?.branding?.welcomeMessage ?? ""}
          disabled={disabled}
          hint="Первое сообщение в пустом чате."
          onChange={(value) => {
            props.write(["branding", "welcomeMessage"], value);
          }}
        />
        <TextField
          label="Подсказка в поле ввода"
          value={config?.branding?.placeholder ?? ""}
          disabled={disabled}
          hint="Текст-заглушка в строке вопроса."
          onChange={(value) => {
            props.write(["branding", "placeholder"], value);
          }}
        />
        <TextField
          label="Адрес логотипа"
          value={config?.branding?.logoUrl ?? ""}
          disabled={disabled}
          placeholder="https://…/logo.svg"
          hint="Пусто — без логотипа. Картинка грузится браузером посетителя, поэтому внешний адрес виден ему и его сети."
          onChange={(value) => {
            props.write(["branding", "logoUrl"], value);
          }}
        />
      </div>
      <TextField
        label="Плашка о данных"
        value={config?.branding?.disclaimer ?? ""}
        disabled={disabled}
        multiline
        rows={3}
        hint="Показывается под строкой ввода. Пустое поле скрывает плашку: тогда о видимости диалогов и их использовании сообщать нечем."
        onChange={(value) => {
          props.write(["branding", "disclaimer"], value);
        }}
      />
      {(config?.branding?.disclaimer ?? "") === "" ? (
        <Notice tone="warn">
          Плашка о данных скрыта. Диалоги могут быть видны другим пользователям
          сервера и использоваться для улучшения ответов — предупредите об этом
          сами.
        </Notice>
      ) : null}
    </Section>
  );
}
