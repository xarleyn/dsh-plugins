export class ConfigError extends Error {
  readonly ruleId: string | undefined;

  constructor(message: string, ruleId?: string) {
    const context = ruleId === undefined ? '' : `\nrule "${ruleId}":`;
    super(`dsh-doc-impact:${context}\n${message}`);
    this.name = 'ConfigError';
    this.ruleId = ruleId;
  }
}
