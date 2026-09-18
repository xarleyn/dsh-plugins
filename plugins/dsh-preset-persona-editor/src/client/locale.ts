/**
 * Every string the persona page renders, in one place.
 *
 * The page is deliberately not registered with the client locale service: it
 * owns no dictionary another feature reads, and a page that shipped one string
 * per locale would be a translation burden with no reader. Keeping the copy
 * here still gives the one thing that matters — a single file to review when
 * the wording changes.
 * @module client/locale
 */

export const strings = {
  /** Settings navigation label. */
  nav: "Persona",

  loading: "Loading agent presets…",
  loadFailed: "The preset roster could not be read.",
  empty: "This deployment composes no agent presets.",
  intro:
    "Each agent preset can carry its own persona. Pick a preset to edit the system-prompt text it composes with, or reset it to inherit the deployment's persona.",

  /** Badges on a roster row. */
  badgeCustom: "Custom",
  badgeInherited: "Inherited",
  badgeShipped: "Shipped",
  badgeAmbiguous: "Two rows",
  badgeUnreadable: "Unreadable",

  /** Roster row description fragments. */
  describesComplete: "complete system prompt",
  describesMissing: "no persona row: the deployment's persona applies",
  describesAmbiguous: "more than one persona row",
  describesError: "not readable as a composition",
  describedDefault: "default preset",

  open: "Edit persona",
  close: "Close",

  prefixLabel: "Persona prefix",
  prefixHint:
    "The role's main instructions. They replace the deployment's persona prefix for this preset.",
  suffixLabel: "Persona suffix",
  suffixHint:
    "Additional instructions rendered after the first-party guidance.",
  completeLabel: "Complete system prompt",
  completeHint:
    "This persona replaces other system-prompt sections for this agent. Runtime context is dropped as well unless it is included below.",
  completeWarning:
    "This persona replaces other system-prompt sections for this agent.",
  runtimeLabel: "Include runtime context",
  runtimeHint:
    "Send the dynamic runtime-context snapshots (sandbox, approval, working directory) with this persona.",

  save: "Save",
  saving: "Saving…",
  revert: "Revert",
  reset: "Reset",
  resetting: "Resetting…",
  reload: "Reload",

  saved: "Saved to the preset composition.",
  nothingToSave: "No changes to save.",
  conflict:
    "Preset was modified externally. Reload before saving your changes.",
  gone: "This preset is no longer in the roster.",
  readOnlyShipped:
    "This preset ships with the deployment and cannot be edited.",
  unreadable: "This preset's composition cannot be rewritten by this editor.",
  dirty: "Unsaved changes",

  copyTitle: "Copy and edit",
  copyHint:
    "A shipped preset belongs to the deployment. Copy it to your own presets and edit the copy.",
  copyIdLabel: "New preset id",
  copyNameLabel: "Display name",
  copyAction: "Copy",
  copying: "Copying…",
  copyFailed: "The preset could not be copied.",

  previewTitle: "Preview",
  previewConfig: "Persona config",
  previewStructure: "Effective prompt structure",
  previewStructureHint:
    "Approximate: the harness assembles these sections in this order.",
  outlineIdentity: "Harness identity",
  outlinePrefix: "Preset persona prefix",
  outlineInheritedPrefix: "Deployment persona prefix (inherited)",
  outlineFirstParty: "Tool and first-party instructions",
  outlineContext: "Runtime context",
  outlineContextOff: "Runtime context (suppressed by this persona)",
  outlineSuffix: "Preset persona suffix",
  outlineInheritedSuffix: "Deployment persona suffix (inherited)",
  outlineComplete: "Only this persona is sent; every other section is dropped.",
  outlineSuppressed: "Suppressed: this persona writes the complete prompt.",
  outlineRows: (rows: number): string =>
    `The preset composes ${rows} plugin row${rows === 1 ? "" : "s"}.`,
  outlineSection: (name: string): string => `Section: ${name}`,
  outlineSectionOff: "off",

  sectionsTitle: "Advanced: prompt sections",
  sectionsHint:
    "Sections this preset contributes to the assembled prompt, in its own name. A section registered here shadows a deployment-global section with the same name for this preset's sessions.",
  sectionsKeeps:
    "A small registrar the preset carries (prompt-sections.mjs) mounts them, so they keep working with this plugin uninstalled.",
  sectionsEmpty:
    "This preset contributes no sections of its own: the deployment's prompt stands.",
  sectionsAdd: "Add section",
  sectionsRemove: "Remove",
  sectionsRemoveAll: "Remove all",
  sectionNameLabel: "Name",
  sectionOrderLabel: "Order",
  sectionTextLabel: "Text",
  sectionEnabledLabel: "Enabled",
  sectionOff: "off",
  sectionNameMissing: "Give the section a name.",
  sectionNamePadded: "A name cannot start or end with a space.",
  sectionNameDuplicated: "Another section already uses this name.",
  sectionOrderNotWhole: "The order must be a whole number.",
  sectionTextMissing:
    "A section with no text adds nothing; turn it off instead.",
  sectionFirstPartyName:
    "This name belongs to a first-party section, and a section of this preset shadows it.",
  sectionsModulePresent:
    "The preset ships its registrar (prompt-sections.mjs).",
  sectionsModuleForeign:
    "The preset's prompt-sections.mjs was written by hand: this page edits the section list only, and saving leaves that file alone.",
  sectionsModuleMissing:
    "The registrar file is missing, so a sections row would register nothing; saving writes it.",
  sectionsModuleUnknown: "The registrar could not be checked.",
  sectionsAmbiguous:
    "More than one composition row names the registrar, so these sections cannot be edited here.",
  sectionsError: "The section list cannot be rewritten by this editor.",
  sectionsPreview: "Prompt sections config",
  sectionsUnknownKeys: "Keys this editor does not manage in the sections row",

  unknownKeysTitle: "Keys this editor does not manage",
  unknownKeysHint:
    "They are preserved when you save, and removed with the row when you reset.",
  foreignKeysTitle: "Expressions this editor will not rewrite",
  foreignKeysHint:
    "This row sets a managed key to a `!!js` expression. Edit the composition file directly.",
  extraRowsTitle: "More than one persona row",
  extraRowsHint:
    "This preset names more than one @deepseek-ai/dsh-persona row, so no single one is its persona. Edit the composition file directly.",

  fileTitle: "Composition file",
  fileHint: "Source of truth: the preset's own agent.cordis.yml.",
  pathLabel: "Path",
} as const;
