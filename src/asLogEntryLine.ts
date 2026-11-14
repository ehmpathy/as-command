import { asJsonTotal } from './asJsonTotal';

/**
 * .what = renders one log entry as the block appended to log.json
 * .why = log.json holds one pretty-printed json object per entry, each followed by a comma
 * .note = via asJsonTotal: a circular ref renders "[Circular]", a bigint "<n>n", an Error keeps
 *         its name, message, and stack — so a log call does not throw on, or lose, its metadata
 */
export const asLogEntryLine = (input: {
  level: string;
  timestamp: string;
  message: string;
  metadata: unknown;
}): string =>
  `${asJsonTotal({
    value: {
      level: input.level,
      timestamp: input.timestamp,
      message: input.message,
      metadata: input.metadata,
    },
    indent: 2,
  })},\n`;
