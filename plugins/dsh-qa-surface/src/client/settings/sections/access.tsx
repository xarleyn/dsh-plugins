/**
 * Access and route: the only section whose consequences reach beyond this
 * plugin's namespace — the path it claims on the Host and where external
 * visitors of the harness root land.
 */

import { Notice, Section, TextField, Toggle } from "../fields.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

/** Where the page lives and who may reach it. */
export function AccessSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const paths: SectionPaths = [["enabled"], ["route"], ["entry"]];
  const modified = overriddenAny(props, paths);
  return (
    <Section
      title="Доступ и маршрут"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <div className="qa-card-grid">
        <Toggle
          checked={config?.enabled ?? true}
          disabled={disabled}
          label="Страница включена"
          hint="Выключенная страница не отвечает по маршруту и не перенаправляет внешние входы."
          onChange={(value) => {
            props.write(["enabled"], value);
          }}
        />
        <Toggle
          checked={config?.route?.matchChildren ?? true}
          disabled={disabled}
          label="Включая вложенные пути"
          hint="Маршрут с вложенными адресами остаётся страницей помощника."
          onChange={(value) => {
            props.write(["route", "matchChildren"], value);
          }}
        />
        <TextField
          label="Путь страницы"
          value={config?.route?.path ?? "/qa"}
          disabled={disabled}
          placeholder="/qa"
          hint="Начинается с «/»; нельзя занять «/», «/api» и «/plugins». Смена пути перерегистрирует маршрут на хосте."
          onChange={(value) => {
            props.write(["route", "path"], value);
          }}
        />
        <Toggle
          checked={config?.entry?.redirectNonLoopback ?? true}
          disabled={disabled}
          label="Внешние входы — на страницу помощника"
          hint="Корень харнесса, открытый по внешнему адресу, переадресуется сюда. Локальный вход оператора не затрагивается."
          onChange={(value) => {
            props.write(["entry", "redirectNonLoopback"], value);
          }}
        />
      </div>
      {(config?.entry?.redirectNonLoopback ?? true) ? (
        <Notice tone="info">
          Перенаправление включено: любой, кто открыл харнесс по внешнему
          адресу, попадёт на страницу помощника, а не в интерфейс разработчика.
        </Notice>
      ) : (
        <Notice tone="warn">
          Перенаправление выключено: внешний посетитель корня харнесса остаётся
          в полном интерфейсе разработчика. Убедитесь, что он закрыт другими
          средствами.
        </Notice>
      )}
    </Section>
  );
}
