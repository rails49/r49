/**
 * The rule ids a refused archive names, as FORMAT.md § Format rule ids defines
 * them. The id is the contract; the wording of a message is free to change.
 */
export const RULES = [
  'format/zip',
  'format/manifest-missing',
  'format/manifest-json',
  'format/version',
  'format/unknown-key',
  'format/duplicate-id',
  'format/provenance',
  'format/field',
] as const;

export type FormatRule = (typeof RULES)[number];

/** Thrown for every archive or manifest that breaks a format rule. */
export class FormatError extends Error {
  /** The rule broken. Match on this, never on the message. */
  readonly rule: FormatRule;

  constructor(rule: FormatRule, message: string) {
    super(message);
    this.name = 'FormatError';
    this.rule = rule;
  }
}
