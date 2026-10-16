/**
 * Shared form-body vocabulary for operator plugin pages. Selectors are local
 * to each bundle, so loading two plugin versions cannot restyle each other.
 * This deliberately contains no outer card: the Host owns that surface.
 */
export interface SettingsBodySelectors {
  readonly body: string;
  readonly section?: string;
  readonly sectionTitle?: string;
  readonly grid?: string;
  readonly field?: string;
  readonly fieldLabel?: string;
  readonly hint?: string;
  readonly control?: string;
  readonly button?: string;
  readonly toggleRow?: string;
  readonly toggleCopy?: string;
  readonly toggle?: string;
  readonly notice?: string;
}

/**
 * Apply the same type scale, spacing and controls to an existing card without
 * renaming its DOM hooks, settings paths or registration. Pass trusted CSS
 * selectors from source; never interpolate configuration or user input.
 * Omit a role when the page has a specialized layout for it.
 */
export function settingsBodyStyles(s: SettingsBodySelectors): string {
  const rules: string[] = [];
  const add = (selector: string | undefined, css: string) => {
    if (selector !== undefined) rules.push(`${selector}{${css}}`);
  };
  // Keep the complete focus declaration in the shipped source: the package
  // contract inspects bundles without executing their modules.
  const focus = (selector: string) => {
    rules.push(
      `${selector}:focus-visible{outline:var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}`,
    );
  };
  add(`${s.body},${s.body} *`, "box-sizing:border-box");
  add(
    s.body,
    "min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5;overflow-wrap:anywhere",
  );
  add(s.section, "display:grid;gap:12px;min-width:0");
  add(
    s.sectionTitle,
    "display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-width:0",
  );
  if (s.sectionTitle !== undefined) {
    add(
      `${s.sectionTitle} h3`,
      "margin:0;font-size:16px;font-weight:600;line-height:1.5",
    );
  }
  add(
    s.grid,
    "display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px 20px;min-width:0;align-items:start",
  );
  add(s.field, "display:grid;gap:6px;min-width:0");
  add(
    s.fieldLabel,
    "font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary);line-height:1.5",
  );
  add(
    s.hint,
    "font-size:12px;font-weight:400;line-height:1.5;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere",
  );
  if (s.control !== undefined) {
    add(
      s.control,
      "width:100%;min-width:0;min-height:36px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);padding:7px 10px;font:inherit;font-size:14px;line-height:1.5",
    );
    add(`${s.control}:is(textarea)`, "resize:vertical;min-height:76px");
    focus(s.control);
    add(`${s.control}:disabled`, "cursor:default;opacity:.5");
  }
  if (s.button !== undefined) {
    add(
      s.button,
      "min-height:34px;height:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);padding:6px 12px;font:inherit;font-size:13px;font-weight:500;line-height:1.5;cursor:pointer;white-space:normal",
    );
    add(
      `${s.button}:hover:not(:disabled)`,
      "border-color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-layer-2)",
    );
    focus(s.button);
    add(`${s.button}:disabled`, "cursor:default;opacity:.5");
  }
  add(
    s.toggleRow,
    "display:flex;align-items:flex-start;justify-content:space-between;gap:16px;min-width:0;padding:12px 0;border:0;border-radius:0;background:transparent",
  );
  if (s.toggleCopy !== undefined) {
    add(
      s.toggleCopy,
      "display:flex;flex:1;flex-direction:column;gap:4px;min-width:0",
    );
    add(
      `${s.toggleCopy} strong`,
      "display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;min-width:0;font-size:14px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)",
    );
    add(
      `${s.toggleCopy}>span`,
      "font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)",
    );
  }
  if (s.toggle !== undefined) {
    add(
      s.toggle,
      "appearance:none;width:34px;height:20px;flex:none;border:0;border-radius:999px;background:var(--dsw-alias-label-dimmed);position:relative;margin:1px 0 0;cursor:pointer;transition:background .16s",
    );
    add(
      `${s.toggle}:after`,
      "content:'';position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-layer-3);transform:none;transition:transform .16s",
    );
    add(`${s.toggle}:checked`, "background:var(--dsw-alias-brand-primary)");
    add(`${s.toggle}:checked:after`, "transform:translateX(14px)");
    focus(s.toggle);
    add(`${s.toggle}:disabled`, "cursor:default;opacity:.5");
  }
  add(
    s.notice,
    "padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;font-size:13px;line-height:1.5;overflow-wrap:anywhere",
  );
  rules.push(
    "@media(prefers-reduced-motion:reduce){" +
      (s.toggle === undefined
        ? ""
        : `${s.toggle},${s.toggle}:after{transition:none}`) +
      "}",
  );
  return rules.join("\n") + "\n";
}
