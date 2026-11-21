import * as fs from 'fs/promises';
import { dirname } from 'path';
import type { LogMethods } from 'simple-leveled-log-methods';

import { asJsonClone } from './asJsonClone';
import { asOutFileContent } from './asOutFileContent';
import { asRunId } from './asRunId';
import { genRunLog } from './genRunLog';

/**
 * context provided by the command
 */
export interface CommandContext {
  log: LogMethods;
  out: {
    write: (file: {
      name: string;
      data: Parameters<typeof fs.writeFile>[1];
    }) => Promise<{ path: string }>;
  };
}

/**
 * converts any function into a pit-of-success command
 *
 * features
 * - observability
 *   - logs inputs, outputs, and errors to console
 *   - persists inputs, outputs, and errors to file storage (locally and optionally to s3)
 * - parallelism
 *   - supports parallel operations with progress reports
 * - experience
 *   - easily pass in inputs from the command line
 */
export const asCommand =
  <I, O>(
    options: {
      name: string;
      purpose?: string;
      stage: string;
      log: LogMethods;
      dir: string;
    },
    logic: (input: I, context: CommandContext) => Promise<O>,
  ) =>
  async (input: I): Promise<O> => {
    // define the run directory and its files
    const runId = asRunId({ calledAt: new Date(), input });
    const logFileDirectory = `${options.dir}/__tmp__/${options.stage}/${options.name}/${runId}`;
    const logFilePath = `${logFileDirectory}/log.json`;
    const outFilePath = `${logFileDirectory}/out.json`;
    const runLog = genRunLog({ path: logFilePath });

    // find or create the run directory
    await fs.mkdir(logFileDirectory, {
      recursive: true,
    });

    // define how to log an entry; emit and stamp at call time, then append to this run's log
    const logLevelAbstraction = async (
      level: keyof LogMethods,
      message: string,
      metadata?: any,
    ) => {
      // the console gets the same total render as the file, so a logger that stringifies never loses or throws on it
      options.log[level](message, asJsonClone({ value: metadata }));
      return runLog.append({
        level,
        timestamp: new Date().toISOString(),
        message,
        metadata,
      });
    };

    // define the wrapped logger
    const log: LogMethods = {
      debug: (message, metadata) =>
        logLevelAbstraction('debug', message, metadata),
      info: (message, metadata) =>
        logLevelAbstraction('info', message, metadata),
      warn: (message, metadata) =>
        logLevelAbstraction('warn', message, metadata),
      error: (message, metadata) =>
        logLevelAbstraction('error', message, metadata),
    };

    // open the log file, then log the inputs
    await runLog.open();
    await log.info('input', { input });

    try {
      // execute the logic
      const output = await logic(input, {
        log,
        out: {
          write: async ({ name, data }) => {
            const path = `${logFileDirectory}/${name}`;
            await fs.mkdir(dirname(path), { recursive: true });
            await fs.writeFile(path, data);
            return { path };
          },
        },
      });

      // log the output
      await log.info('output.result', { output });

      // save the output
      await fs.appendFile(outFilePath, asOutFileContent({ output }));

      // log out where the user can find them
      await log.info('output.files', { log: logFilePath, out: outFilePath });

      // return the output
      return output;
    } catch (error) {
      // log whatever was thrown, whole: an Error renders as its name, message, stack, and own props
      await log.error('output.error', { error });

      // rethrow the error
      throw error;
    } finally {
      // seal the log file, after every entry queued before it
      await runLog.seal();
    }
  };
