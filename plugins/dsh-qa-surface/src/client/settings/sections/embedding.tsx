/**
 * Embedding: one CSP field with a wide blast radius — an overly generous
 * frame-ancestors list lets any listed site run this page as its own UI.
 */

import { Notice, Section, TextField } from "../fields.js";
import {
  overriddenAny,
  resetAside,
  type ConfigProps,
  type SectionPaths,
} from "./common.js";

/** Embedding the page into another site's frame. */
export function EmbeddingSection(props: ConfigProps) {
  const config = props.config;
  const disabled = !props.writable;
  const frameAncestors = config?.embedding?.frameAncestors ?? "";
  const paths: SectionPaths = [["embedding"]];
  const modified = overriddenAny(props, paths);
  return (
    <Section
      title="Встраивание"
      modified={modified}
      aside={resetAside(props, paths)}
    >
      <TextField
        label="Источники для iframe"
        value={frameAncestors}
        disabled={disabled}
        placeholder="https://portal.example"
        hint="Значение заголовка Content-Security-Policy: frame-ancestors. Пусто — страницу нельзя встроить в чужой фрейм."
        onChange={(value) => {
          props.write(["embedding", "frameAncestors"], value);
        }}
      />
      {frameAncestors !== "" ? (
        <Notice tone="warn">
          Встраивание разрешено для «{frameAncestors}». Эти сайты смогут
          показать страницу помощника в своём фрейме; убедитесь, что список
          узкий.
        </Notice>
      ) : null}
    </Section>
  );
}
