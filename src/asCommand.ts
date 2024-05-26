import Bottleneck from 'bottleneck';
import * as crypto from 'crypto';
import { format } from 'date-fns';
import * as fs from 'fs/promises';
import type { LogMethods } from 'simple-leveled-log-methods';

const bottleneckFileLog = new Bottleneck({ maxConcurrency: 1 });

/**
 * converts any function into a pit-of-success command
 *
 * features
 * - observability
 *   - logs inputs, outputs, and errors to console
 *   - persists inputs, outputs, and errors to file storage (locally and optionally to s3)
 * - parallelism
 *   - supports parallel operations with progress reporting
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
    logic: (
      input: I,
      control: {
        log: LogMethods;
        out: {
          write: (file: {
            name: string;
            data: Parameters<typeof fs.writeFile>[1];
          }) => Promise<{ path: string }>;
        };
      },
    ) => Promise<O>,
  ) =>
  async (input: I): Promise<O> => {
    const calledAt = new Date();

    // define the log file directory and name
    const inputHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    const logFileDirectory = `${options.dir}/__tmp__/${options.stage}/${options.name}`;
    const logFilePrefix = `${format(calledAt, 'yyyyMMdd.HHmmss')}.${inputHash}`;
    const logFileName = `${logFilePrefix}.log.json`;
    const outFileName = `${logFilePrefix}.out.json`;

    // find or create the temp log table
    await fs.mkdir(logFileDirectory, {
      recursive: true,
    });

    // define how to log something
    const logLevelAbstraction = async (
      level: keyof LogMethods,
      message: string,
      metadata?: any,
    ) =>
      bottleneckFileLog.schedule(async () => {
        options.log[level](message, metadata);
        return fs.appendFile(
          `${logFileDirectory}/${logFileName}`,
          `${JSON.stringify(
            { level, timestamp: new Date().toISOString(), message, metadata },
            null,
            2,
          )},\n`,
        );
      });

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

    // log the inputs
    await fs.appendFile(`${logFileDirectory}/${logFileName}`, '[\n');
    await log.info('input', { input });

    try {
      // execute the logic
      const output = await logic(input, {
        log,
        out: {
          write: async ({ name, data }) => {
            const path = `${logFileDirectory}/${logFilePrefix}.out.${name}`;
            await fs.writeFile(path, data);
            return { path };
          },
        },
      });

      // log the output
      await log.info('output.result', { output });

      // save the output
      await fs.appendFile(
        `${logFileDirectory}/${outFileName}`,
        typeof output === 'string'
          ? output
          : JSON.stringify(output, null, 2) || 'undefined',
      );

      // log out where the user can find them
      await log.info('output.files', {
        log: `${logFileDirectory}/${logFileName}`,
        out: `${logFileDirectory}/${outFileName}`,
      });

      // return the output
      return output;
    } catch (error) {
      if (!(error instanceof Error)) throw error;

      // log the error
      await log.error('output.error', {
        error: { ...error, message: error.message },
      });

      // rethrow the error
      throw error;
    } finally {
      await fs.appendFile(`${logFileDirectory}/${logFileName}`, ']\n');
    }
  };
