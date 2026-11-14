import { asJsonTotal } from './asJsonTotal';

/**
 * .what = a deep copy of a value, in the shape json can hold: the same render log.json gets
 * .why = the adopter's logger stringifies metadata (local and aws-lambda), so a raw value fails it two ways:
 *        an Error renders `{}` (its message lost), and a circular ref or bigint throws, which would replace
 *        the caller's own error. the copy marks each such value instead (Error as a record, `[Circular]`, `42n`)
 * .note = the copy is taken at the call, so a later mutation of the metadata never reaches the console
 */
export const asJsonClone = (input: { value: unknown }): unknown => {
  // json has no form for undefined; pass it through, as the logger expects for absent metadata
  const rendered = asJsonTotal({ value: input.value, indent: null });
  if (rendered === undefined) return undefined;

  // parse the total render back into a plain value
  return JSON.parse(rendered);
};
