import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LogMethods } from 'simple-leveled-log-methods';
import { given, when, then, getError } from 'test-fns';

import { asCommand } from './asCommand';

describe('asCommand (integration)', () => {
  const testDir = resolve(__dirname, '.temp/asCommand');

  given('a command created with asCommand', () => {
    const realLog: LogMethods = {
      debug: (message, metadata?) => {
        console.debug(message, metadata);
      },
      info: (message, metadata?) => {
        console.info(message, metadata);
      },
      warn: (message, metadata?) => {
        console.warn(message, metadata);
      },
      error: (message, metadata?) => {
        console.error(message, metadata);
      },
    };

    when('invoked with input', () => {
      then(
        'it should execute the logic and persist logs and outputs to disk',
        async () => {
          // Create a simple command
          const testCommand = asCommand<{ value: number }, { doubled: number }>(
            {
              name: 'double-value',
              purpose: 'doubles a number',
              stage: 'test',
              log: realLog,
              dir: testDir,
            },
            async (input, context) => {
              context.log.info('processing', { input });
              return { doubled: input.value * 2 };
            },
          );

          // Execute the command
          const result = await testCommand({ value: 21 });

          // Verify the result
          expect(result).toEqual({ doubled: 42 });

          // Verify directory structure was created
          const commandDir = `${testDir}/__tmp__/test/double-value`;
          expect(existsSync(commandDir)).toBe(true);

          // Find the run directory
          const runDirs = await readdir(commandDir);
          expect(runDirs.length).toBeGreaterThan(0);

          const runDir = `${commandDir}/${runDirs[0]}`;
          const logFilePath = `${runDir}/log.json`;
          const outFilePath = `${runDir}/out.json`;

          expect(existsSync(logFilePath)).toBe(true);
          expect(existsSync(outFilePath)).toBe(true);

          // Read and verify log file contents
          const logContents = await readFile(logFilePath, 'utf-8');
          expect(logContents).toContain('"level": "info"');
          expect(logContents).toContain('"message": "input"');
          expect(logContents).toContain('"value": 21');
          expect(logContents).toContain('"message": "processing"');
          expect(logContents).toContain('"message": "output.result"');
          expect(logContents).toContain('"doubled": 42');

          // Read and verify output file contents
          const outContents = await readFile(outFilePath, 'utf-8');
          const output = JSON.parse(outContents);
          expect(output).toEqual({ doubled: 42 });
        },
      );
    });

    when('the logic uses context.out.write', () => {
      then('it should write custom output files to disk', async () => {
        const testCommand = asCommand<{ name: string }, { message: string }>(
          {
            name: 'greet-user',
            purpose: 'greets a user',
            stage: 'test',
            log: realLog,
            dir: testDir,
          },
          async (input, context) => {
            // Write a custom file using context.out.write
            const csvData = `name,greeting\n${input.name},Hello ${input.name}!`;
            const result = await context.out.write({
              name: 'greeting.csv',
              data: csvData,
            });

            context.log.info('wrote csv file', { path: result.path });

            return { message: `Greeted ${input.name}` };
          },
        );

        const result = await testCommand({ name: 'Alice' });

        expect(result).toEqual({ message: 'Greeted Alice' });

        // Verify custom output file was created
        const commandDir = `${testDir}/__tmp__/test/greet-user`;
        const runDirs = await readdir(commandDir);
        const runDir = `${commandDir}/${runDirs[0]}`;
        const csvFilePath = `${runDir}/greeting.csv`;

        expect(existsSync(csvFilePath)).toBe(true);

        const csvContents = await readFile(csvFilePath, 'utf-8');
        expect(csvContents).toContain('name,greeting');
        expect(csvContents).toContain('Alice,Hello Alice!');
      });
    });

    when('the logic uses context.out.write with nested directories', () => {
      then(
        'it should create nested directories and write the file',
        async () => {
          const testCommand = asCommand<{ data: string }, { saved: boolean }>(
            {
              name: 'nested-output',
              purpose: 'writes to nested directories',
              stage: 'test',
              log: realLog,
              dir: testDir,
            },
            async (input, context) => {
              // Write a file to a nested path that doesn't exist yet
              const result = await context.out.write({
                name: 'reports/analytics/data.json',
                data: JSON.stringify({ value: input.data }, null, 2),
              });

              context.log.info('wrote nested file', { path: result.path });

              return { saved: true };
            },
          );

          const result = await testCommand({ data: 'test-data' });

          expect(result).toEqual({ saved: true });

          // Verify the file was created in the nested directory
          const commandDir = `${testDir}/__tmp__/test/nested-output`;
          const runDirs = await readdir(commandDir);
          const runDir = `${commandDir}/${runDirs[0]}`;
          const nestedFilePath = `${runDir}/reports/analytics/data.json`;

          expect(existsSync(nestedFilePath)).toBe(true);

          const fileContents = await readFile(nestedFilePath, 'utf-8');
          const parsed = JSON.parse(fileContents);
          expect(parsed).toEqual({ value: 'test-data' });
        },
      );
    });

    when('the logic throws an error', () => {
      then('it should log the error and rethrow it', async () => {
        const testCommand = asCommand<{ shouldFail: boolean }, never>(
          {
            name: 'failing-command',
            purpose: 'intentionally fails',
            stage: 'test',
            log: realLog,
            dir: testDir,
          },
          async (input) => {
            if (input.shouldFail) {
              throw new Error('Intentional failure');
            }
            throw new Error('Should not reach here');
          },
        );

        // Execute and expect error
        const error = await getError(() => testCommand({ shouldFail: true }));

        expect(error?.message).toContain('Intentional failure');

        // Verify error was logged to file
        const commandDir = `${testDir}/__tmp__/test/failing-command`;
        const runDirs = await readdir(commandDir);
        const runDir = `${commandDir}/${runDirs[0]}`;
        const logFilePath = `${runDir}/log.json`;

        expect(existsSync(logFilePath)).toBe(true);

        const logContents = await readFile(logFilePath, 'utf-8');
        expect(logContents).toContain('"level": "error"');
        expect(logContents).toContain('"message": "output.error"');
        expect(logContents).toContain('Intentional failure');
      });
    });

    when('invoked multiple times with same input', () => {
      then(
        'it should create separate log files with same input hash but different timestamps',
        async () => {
          const testCommand = asCommand<{ value: string }, { result: string }>(
            {
              name: 'echo-command',
              purpose: 'echoes input',
              stage: 'test',
              log: realLog,
              dir: testDir,
            },
            async (input) => {
              // Add small delay to ensure different timestamps
              await new Promise((resolveTimer) =>
                setTimeout(resolveTimer, 1100),
              );
              return { result: input.value };
            },
          );

          // Execute twice with same input
          await testCommand({ value: 'test' });
          await testCommand({ value: 'test' });

          // Verify multiple run directories exist
          const commandDir = `${testDir}/__tmp__/test/echo-command`;
          const runDirs = await readdir(commandDir);

          expect(runDirs.length).toBeGreaterThanOrEqual(2);

          // Verify directories have same hash but different timestamps
          const hashes = runDirs.map((d) => d.split('.')[2]);
          const timestamps = runDirs.map((d) =>
            d.split('.').slice(0, 2).join('.'),
          );

          expect(hashes[0]).toBe(hashes[1]); // Same input hash
          expect(timestamps[0]).not.toBe(timestamps[1]); // Different timestamps
        },
      );
    });

    when('invoked with different inputs', () => {
      then('it should create files with different input hashes', async () => {
        const testCommand = asCommand<{ id: number }, { processed: boolean }>(
          {
            name: 'process-id',
            purpose: 'processes an id',
            stage: 'test',
            log: realLog,
            dir: testDir,
          },
          async () => {
            return { processed: true };
          },
        );

        // Execute with different inputs
        await testCommand({ id: 1 });
        await testCommand({ id: 2 });

        // Verify run directories have different hashes
        const commandDir = `${testDir}/__tmp__/test/process-id`;
        const runDirs = await readdir(commandDir);

        expect(runDirs.length).toBeGreaterThanOrEqual(2);

        const hashes = runDirs.map((d) => d.split('.')[2]);
        expect(hashes[0]).not.toBe(hashes[1]); // Different input hashes
      });
    });

    when('the logic uses all log levels', () => {
      then('it should persist all log levels to the log file', async () => {
        const testCommand = asCommand<
          Record<string, never>,
          { complete: boolean }
        >(
          {
            name: 'all-log-levels',
            purpose: 'tests all log levels',
            stage: 'test',
            log: realLog,
            dir: testDir,
          },
          async (_input, context) => {
            context.log.debug('debug message', { level: 'debug' });
            context.log.info('info message', { level: 'info' });
            context.log.warn('warn message', { level: 'warn' });
            context.log.error('error message', { level: 'error' });
            return { complete: true };
          },
        );

        await testCommand({});

        const commandDir = `${testDir}/__tmp__/test/all-log-levels`;
        const runDirs = await readdir(commandDir);
        const runDir = `${commandDir}/${runDirs[0]}`;
        const logFilePath = `${runDir}/log.json`;

        expect(existsSync(logFilePath)).toBe(true);

        const logContents = await readFile(logFilePath, 'utf-8');
        expect(logContents).toContain('"level": "debug"');
        expect(logContents).toContain('"message": "debug message"');
        expect(logContents).toContain('"level": "info"');
        expect(logContents).toContain('"message": "info message"');
        expect(logContents).toContain('"level": "warn"');
        expect(logContents).toContain('"message": "warn message"');
        expect(logContents).toContain('"level": "error"');
        expect(logContents).toContain('"message": "error message"');
      });
    });

    when('the logic returns a string', () => {
      then(
        'it should persist the string directly to the output file',
        async () => {
          const testCommand = asCommand<{ name: string }, string>(
            {
              name: 'return-string',
              purpose: 'returns a string',
              stage: 'test',
              log: realLog,
              dir: testDir,
            },
            async (input) => {
              return `Hello, ${input.name}!`;
            },
          );

          const result = await testCommand({ name: 'World' });

          expect(result).toBe('Hello, World!');

          const commandDir = `${testDir}/__tmp__/test/return-string`;
          const runDirs = await readdir(commandDir);
          const runDir = `${commandDir}/${runDirs[0]}`;
          const outFilePath = `${runDir}/out.json`;

          expect(existsSync(outFilePath)).toBe(true);

          const outContents = await readFile(outFilePath, 'utf-8');
          expect(outContents).toBe('Hello, World!');
        },
      );
    });

    when('the logic returns undefined', () => {
      then('it should persist "undefined" to the output file', async () => {
        const testCommand = asCommand<Record<string, never>, undefined>(
          {
            name: 'return-undefined',
            purpose: 'returns undefined',
            stage: 'test',
            log: realLog,
            dir: testDir,
          },
          async () => {
            return undefined;
          },
        );

        const result = await testCommand({});

        expect(result).toBeUndefined();

        const commandDir = `${testDir}/__tmp__/test/return-undefined`;
        const runDirs = await readdir(commandDir);
        const runDir = `${commandDir}/${runDirs[0]}`;
        const outFilePath = `${runDir}/out.json`;

        expect(existsSync(outFilePath)).toBe(true);

        const outContents = await readFile(outFilePath, 'utf-8');
        expect(outContents).toBe('undefined');
      });
    });
  });
});
