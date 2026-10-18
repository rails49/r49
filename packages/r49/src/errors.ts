/**
 * Every format rule id, as FORMAT.md § Format rules lists them.
 *
 * The id is the contract; the wording of a message is not. A caller that needs
 * to tell one refusal from another — or to word its own message, as the editor
 * does — switches on {@link R49Error.rule}, never on the text.
 */
export const FORMAT_RULE_IDS = [
  'archive/zip',
  'manifest/missing',
  'manifest/json',
  'manifest/version',
  'manifest/unknown-key',
  'manifest/duplicate-id',
  'manifest/provenance',
  'manifest/field',
  'images/missing',
  'images/orphan',
] as const;

/** A format rule id. */
export type FormatRuleId = (typeof FORMAT_RULE_IDS)[number];

/**
 * The one error this package throws for an archive or manifest that breaks a
 * format rule. Anything else thrown is a bug or a misuse, not a verdict on the
 * archive.
 */
export class R49Error extends Error {
  /** The format rule the archive or manifest broke. */
  readonly rule: FormatRuleId;

  constructor(rule: FormatRuleId, message: string) {
    super(message);
    this.name = 'R49Error';
    this.rule = rule;
  }
}
