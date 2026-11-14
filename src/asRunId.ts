import * as crypto from 'crypto';
import { format } from 'date-fns';

import { asJsonTotal } from './asJsonTotal';

/**
 * .what = the id of one command run: the second it was called, then the sha256 of its input
 * .why = runs sort by time, and runs with the same input share a hash, so a reader can find
 *        repeats of one operation
 * .note = total: an input json cannot hold (bigint, circular, `undefined` for a no-arg command)
 *         still hashes, so the command reaches its run dir and its log
 */
export const asRunId = (input: { calledAt: Date; input: unknown }): string =>
  `${format(input.calledAt, 'yyyyMMdd.HHmmss')}.${crypto
    .createHash('sha256')
    .update(asJsonTotal({ value: input.input, indent: null }) ?? 'undefined')
    .digest('hex')}`;
