import { asJsonTotal } from './asJsonTotal';

/**
 * .what = renders a command's output as the content of out.json
 * .why = a string output is kept as is, so a report reads raw; any other value is pretty json
 *        (total over circular refs, bigints, Errors), and `undefined` (which json cannot hold)
 *        is written as the word `undefined`
 */
export const asOutFileContent = (input: { output: unknown }): string =>
  typeof input.output === 'string'
    ? input.output
    : (asJsonTotal({ value: input.output, indent: 2 }) ?? 'undefined');
