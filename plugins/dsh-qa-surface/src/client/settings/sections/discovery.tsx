import { Section, SelectField } from "../fields.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

const paths: SectionPaths = [["tools", "discoveryMode"]];

export function DiscoverySection(props: ConfigProps) {
  return (
    <Section
      title="Инструменты интеграций"
      modified={overriddenAny(props, paths)}
      testId="qa-settings-discovery"
      aside={resetAside(props, paths, "qa-settings-discovery-reset")}
    >
      <SelectField
        label="Доступность инструментов"
        testId="qa-settings-discovery-mode"
        value={
          props.config?.tools?.discoveryMode ??
          props.effective?.tools.discoveryMode ??
          "off"
        }
        disabled={!props.writable}
        options={[
          { value: "off", label: "Выключено" },
          { value: "observe", label: "Только наблюдение" },
          { value: "search", label: "Подгрузка через поиск" },
        ]}
        hint="В новых QA-чатах поиск открывает инструменты GitLab, TeamCity, Test IT, Weblate и Bitrix24 по мере необходимости. Наблюдение только записывает статистику. Права доступа и подтверждения остаются прежними."
        onChange={(value) => props.write(["tools", "discoveryMode"], value)}
      />
    </Section>
  );
}
