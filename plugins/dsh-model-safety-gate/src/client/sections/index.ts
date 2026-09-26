/**
 * Body sections of the Safety Gate settings card.
 *
 * One module per settings plane (gate, input, output, tools, classifier, audit,
 * advanced), the read-only status and verdict views beside them, and the
 * controls those modules share. Each section derives every value from the
 * settings snapshot (effective configuration) or, for the status and verdict
 * views, from the running gate through the `safetyGate` Remote.
 */

export { type ConfigProps } from "./controls.js";
export { GateSection } from "./gate.js";
export { InputSection } from "./input.js";
export { OutputSection } from "./output.js";
export { ToolsSection } from "./tools.js";
export { ClassifierSection } from "./classifier.js";
export { AuditSection } from "./audit.js";
export { AdvancedSection } from "./advanced.js";
export { StatusSection, type StatusProps } from "./status.js";
export { VerdictsSection, type VerdictsProps } from "./verdicts.js";
