import * as fs from 'fs/promises';

import { asLogEntryLine } from './asLogEntryLine';
import { scheduleFileLog } from './scheduleFileLog';

/**
 * .what = the log.json of one command run: open it, append entries, seal it
 * .why = one owner for the file format (`[`, one block per entry, `]`), so a format change
 *        touches this file alone, and asCommand reads as narrative
 * .note = every write rides the one process-wide chain of scheduleFileLog (F01), so `[`, each
 *         entry, and `]` land whole and in call order (F02)
 * .note = each entry renders at call time, before it waits on the chain: the file holds the
 *         entry as it was when logged, whatever the caller does to its metadata after
 * .note = each write is one `fs.appendFile`, never a task that schedules another; a task that
 *         awaited a second scheduled task would wait on itself and hold the chain forever
 */
export const genRunLog = (input: {
  path: string;
}): {
  open: () => Promise<void>;
  append: (entry: {
    level: string;
    timestamp: string;
    message: string;
    metadata: unknown;
  }) => Promise<void>;
  seal: () => Promise<void>;
} => {
  // append one block to this run's file, behind every write queued before it
  const appendFileLog = (block: { data: string }): Promise<void> =>
    scheduleFileLog({ task: () => fs.appendFile(input.path, block.data) });

  // .note = deliberate mutation: each bracket is written once per run; a second open or seal
  //         returns the first write's promise, so a repeat converges instead of a second `[` or `]`
  const brackets: {
    opened: Promise<void> | null;
    sealed: Promise<void> | null;
  } = { opened: null, sealed: null };

  // write a bracket on its first call; return that same write on every later call
  const findsertBracket = (bracket: {
    key: 'opened' | 'sealed';
    data: string;
  }): Promise<void> => {
    const writeFound = brackets[bracket.key];
    if (writeFound) return writeFound;
    const writeNew = appendFileLog({ data: bracket.data });
    brackets[bracket.key] = writeNew;
    return writeNew;
  };

  return {
    open: () => findsertBracket({ key: 'opened', data: '[\n' }),
    append: (entry) => appendFileLog({ data: asLogEntryLine(entry) }),
    seal: () => findsertBracket({ key: 'sealed', data: ']\n' }),
  };
};
