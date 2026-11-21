import type { LogMethods } from 'simple-leveled-log-methods';
import { getError, given, then, when } from 'test-fns';

import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { asCommand } from './asCommand';

/**
 * .what = a log that prints naught
 * .why = burst tests write megabytes of metadata; the file is the subject, not the console
 */
const silentLog: LogMethods = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * .what = a log that records each console call: its level, message, and metadata
 * .why = proves each `context.log.<level>` reaches `options.log.<level>`, with its metadata, in call order
 * .note = deliberate mutation: `calls` is the recorder
 */
const genRecordLog = () => {
  const calls: { level: string; message: string; metadata: unknown }[] = [];
  const record =
    (level: string) =>
    (message: string, metadata?: unknown): void =>
      void calls.push({ level, message, metadata });
  const log: LogMethods = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };
  return { log, calls };
};

/**
 * .what = a log that stringifies each call, as simple-leveled-log-methods does in local and aws-lambda
 * .why = shows what an adopter's console and cloudwatch receive; a value json cannot hold would throw here
 * .note = deliberate mutation: pushes each line onto the caller's array
 */
const genStringifyLog = (input: { lines: string[] }): LogMethods => {
  const emit =
    (level: string) =>
    (message: string, metadata?: unknown): void =>
      void input.lines.push(JSON.stringify({ level, message, metadata }));
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  };
};

/**
 * .what = reads the top-level entry messages of a log.json, in file order
 * .why = top-level keys sit at two spaces of indent; nested `message` keys (e.g. in an error) sit deeper
 */
const getLogMessages = async (input: { path: string }): Promise<string[]> => {
  const contents = await readFile(input.path, 'utf-8');
  return [...contents.matchAll(/^ {2}"message": "(.*)",?$/gm)].map(
    (match) => match[1]!,
  );
};

/**
 * .what = finds the log.json of the sole run of a command
 * .why = each burst test clears its command dir first, so one run dir exists
 */
const getOnlyLogPath = async (input: { commandDir: string }) => {
  const runDirs = await readdir(input.commandDir);
  expect(runDirs).toHaveLength(1);
  return `${input.commandDir}/${runDirs[0]}/log.json`;
};

/**
 * .what = masks the per-run fields of a log.json, so its shape can be snapped
 * .why = timestamps, the run id, the absolute test dir, and an error's stack (host paths, line
 *        numbers) differ on every run, host, or edit; all else in the file is the contract a caller reads
 */
const asLogSnapshot = (input: { contents: string; testDir: string }) =>
  input.contents
    .replace(/"timestamp": "[^"]+"/g, '"timestamp": "<timestamp>"')
    .replace(/"stack":( ?)"(?:[^"\\]|\\.)*"/g, '"stack":$1"<stack>"') // pretty (log.json) or compact (a console line)
    .split(input.testDir)
    .join('<testDir>')
    .replace(/\d{8}\.\d{6}\.[0-9a-f]{64}/g, '<runId>');

// a burst large enough that unserialized appends reorder (larger payloads first)
const BURST_SIZE = 100;
const BURST_RUNS = 5;
const burstEntries = Array.from({ length: BURST_SIZE }, (_, i) => ({
  message: `entry.${i}`,
  metadata: { i, pad: 'x'.repeat((BURST_SIZE - i) * 256) },
}));
const burstMessages = burstEntries.map((entry) => entry.message);

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
          // clear prior runs, so the run dir read below is this run's
          await rm(`${testDir}/__tmp__/test/double-value`, {
            recursive: true,
            force: true,
          });

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
          expect(outContents).toMatchSnapshot(); // out.json, object variant
        },
      );
    });

    when('the logic uses context.out.write', () => {
      then('it should write custom output files to disk', async () => {
        // clear prior runs, so the run dir read below is this run's
        await rm(`${testDir}/__tmp__/test/greet-user`, {
          recursive: true,
          force: true,
        });
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
        expect(csvContents).toMatchSnapshot(); // out.write artifact, raw bytes
      });
    });

    when('the logic uses context.out.write with nested directories', () => {
      then(
        'it should create nested directories and write the file',
        async () => {
          // clear prior runs, so the run dir read below is this run's
          await rm(`${testDir}/__tmp__/test/nested-output`, {
            recursive: true,
            force: true,
          });
          const testCommand = asCommand<
            { data: string },
            { saved: boolean; path: string }
          >(
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

              return { saved: true, path: result.path };
            },
          );

          const result = await testCommand({ data: 'test-data' });

          // Verify the file was created in the nested directory
          const commandDir = `${testDir}/__tmp__/test/nested-output`;
          const runDirs = await readdir(commandDir);
          const runDir = `${commandDir}/${runDirs[0]}`;
          const nestedFilePath = `${runDir}/reports/analytics/data.json`;

          // the whole output, exact: the success flag and the path out.write gave
          expect(result).toEqual({ saved: true, path: nestedFilePath });
          expect(
            asLogSnapshot({ contents: result.path, testDir }),
          ).toMatchSnapshot('out.write path'); // out.write return, `{ path }`

          expect(existsSync(nestedFilePath)).toBe(true);

          const fileContents = await readFile(nestedFilePath, 'utf-8');
          const parsed = JSON.parse(fileContents);
          expect(parsed).toEqual({ value: 'test-data' });
          expect(fileContents).toMatchSnapshot('out.write artifact'); // raw bytes
        },
      );
    });

    when('the logic throws an error', () => {
      then('it should log the error and rethrow it', async () => {
        // clear prior runs, so the run dir read below is this run's
        await rm(`${testDir}/__tmp__/test/failing-command`, {
          recursive: true,
          force: true,
        });
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
        // clear prior runs, so the run dir read below is this run's
        await rm(`${testDir}/__tmp__/test/all-log-levels`, {
          recursive: true,
          force: true,
        });
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
          // clear prior runs, so the run dir read below is this run's
          await rm(`${testDir}/__tmp__/test/return-string`, {
            recursive: true,
            force: true,
          });
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
        // clear prior runs, so the run dir read below is this run's
        await rm(`${testDir}/__tmp__/test/return-undefined`, {
          recursive: true,
          force: true,
        });
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
        expect(outContents).toMatchSnapshot(); // out.json, undefined variant
      });
    });

    when('the logic logs at every level, then returns a string', () => {
      then('log.json and out.json hold the contract shape', async () => {
        const commandDir = `${testDir}/__tmp__/test/snapshot-returns`;
        await rm(commandDir, { recursive: true, force: true });
        const recorder = genRecordLog();
        const testCommand = asCommand<{ name: string }, string>(
          {
            name: 'snapshot-returns',
            stage: 'test',
            log: recorder.log,
            dir: testDir,
          },
          async (input, context) => {
            await context.log.debug('step.debug', { step: 1 });
            await context.log.info('step.info', { step: 2 });
            await context.log.warn('step.warn', { step: 3 });
            await context.log.error('step.error', { step: 4 });
            return `hello ${input.name}`;
          },
        );

        const output = await testCommand({ name: 'kai' });
        expect(output).toEqual('hello kai');

        const logPath = await getOnlyLogPath({ commandDir });
        const outPath = logPath.replace(/log\.json$/, 'out.json');
        expect(await getLogMessages({ path: logPath })).toEqual([
          'input',
          'step.debug',
          'step.info',
          'step.warn',
          'step.error',
          'output.result',
          'output.files',
        ]);
        expect(
          asLogSnapshot({
            contents: await readFile(logPath, 'utf-8'),
            testDir,
          }),
        ).toMatchSnapshot('log.json');
        expect(await readFile(outPath, 'utf-8')).toMatchSnapshot('out.json');

        // the console got each call at its own level, with its metadata, in call order
        expect(recorder.calls.slice(1, 5)).toEqual([
          { level: 'debug', message: 'step.debug', metadata: { step: 1 } },
          { level: 'info', message: 'step.info', metadata: { step: 2 } },
          { level: 'warn', message: 'step.warn', metadata: { step: 3 } },
          { level: 'error', message: 'step.error', metadata: { step: 4 } },
        ]);
        expect(
          asLogSnapshot({
            contents: JSON.stringify(recorder.calls, null, 2),
            testDir,
          }),
        ).toMatchSnapshot('console'); // the console calls, whole
      });
    });

    when('the logic logs, then throws', () => {
      then('log.json holds the error entry, sealed by `]`', async () => {
        const commandDir = `${testDir}/__tmp__/test/snapshot-throws`;
        await rm(commandDir, { recursive: true, force: true });
        const testCommand = asCommand<{ name: string }, never>(
          {
            name: 'snapshot-throws',
            stage: 'test',
            log: silentLog,
            dir: testDir,
          },
          async (_input, context) => {
            await context.log.info('step.info', { step: 1 });
            throw new Error('bad record');
          },
        );

        const error = await getError(() => testCommand({ name: 'kai' }));
        expect(error.message).toEqual('bad record');

        const logPath = await getOnlyLogPath({ commandDir });
        expect(await getLogMessages({ path: logPath })).toEqual([
          'input',
          'step.info',
          'output.error',
        ]);
        const contents = await readFile(logPath, 'utf-8');

        // the error entry keeps what an on-call engineer debugs from: name, message, stack
        expect(contents).toContain('"name": "Error"');
        expect(contents).toContain('"message": "bad record"');
        expect(contents).toMatch(/"stack": "Error: bad record\\n {4}at /);
        expect(asLogSnapshot({ contents, testDir })).toMatchSnapshot();
      });
    });

    when('the logic throws a value that is not an Error', () => {
      then(
        'the caller gets the same value, and log.json still holds it as output.error',
        async () => {
          const commandDir = `${testDir}/__tmp__/test/throws-non-error`;
          await rm(commandDir, { recursive: true, force: true });
          const thrown = { code: 'E_QUOTA', detail: 'daily cap reached' };
          const testCommand = asCommand<Record<string, never>, never>(
            {
              name: 'throws-non-error',
              stage: 'test',
              log: silentLog,
              dir: testDir,
            },
            async () => {
              // legal in js, and common from older libraries: a rejection with a plain object
              return Promise.reject(thrown);
            },
          );

          const caught = await testCommand({}).then(
            () => null,
            (reason: unknown) => reason,
          );
          expect(caught).toBe(thrown);

          const logPath = await getOnlyLogPath({ commandDir });
          expect(await getLogMessages({ path: logPath })).toEqual([
            'input',
            'output.error',
          ]);
          const contents = await readFile(logPath, 'utf-8');
          expect(contents).toContain('"code": "E_QUOTA"');
          expect(contents.trimEnd()).toMatch(/\]$/);
          expect(asLogSnapshot({ contents, testDir })).toMatchSnapshot();
        },
      );
    });

    when('the logic awaits one log call, then returns', () => {
      then(
        'the entry lands between input and output.result, and the file is sealed',
        async () => {
          const commandDir = `${testDir}/__tmp__/test/awaited-one-log`;
          await rm(commandDir, { recursive: true, force: true });
          const testCommand = asCommand<Record<string, never>, { ok: true }>(
            {
              name: 'awaited-one-log',
              stage: 'test',
              log: silentLog,
              dir: testDir,
            },
            async (_input, context) => {
              await context.log.info('processed', { step: 1 });
              return { ok: true };
            },
          );

          await testCommand({});

          const logPath = await getOnlyLogPath({ commandDir });
          expect(await getLogMessages({ path: logPath })).toEqual([
            'input',
            'processed',
            'output.result',
            'output.files',
          ]);
          expect((await readFile(logPath, 'utf-8')).trimEnd()).toMatch(/\]$/);
        },
      );
    });

    when('the logic fires a burst of log calls without await', () => {
      then(
        'every entry lands in call order, and the final `]` lands last — across repeated bursts',
        async () => {
          for (const run of Array.from({ length: BURST_RUNS }, (_, i) => i)) {
            const name = `unawaited-burst-${run}`;
            const commandDir = `${testDir}/__tmp__/test/${name}`;
            await rm(commandDir, { recursive: true, force: true });
            const testCommand = asCommand<Record<string, never>, { ok: true }>(
              { name, stage: 'test', log: silentLog, dir: testDir },
              async (_input, context) => {
                burstEntries.forEach((entry) => {
                  void context.log.info(entry.message, entry.metadata);
                });
                return { ok: true };
              },
            );

            await testCommand({});

            const logPath = await getOnlyLogPath({ commandDir });
            expect(await getLogMessages({ path: logPath })).toEqual([
              'input',
              ...burstMessages,
              'output.result',
              'output.files',
            ]);
            const contents = await readFile(logPath, 'utf-8');
            expect(contents.startsWith('[\n')).toBe(true); // `[` lands first
            expect(contents.trimEnd()).toMatch(/\]$/); // `]` lands last
          }
        },
      );
    });

    when('the logic fires a burst without await, then throws', () => {
      then(
        'the caller gets the error; the log holds the burst in order, then output.error, then `]`',
        async () => {
          const commandDir = `${testDir}/__tmp__/test/unawaited-burst-then-throw`;
          await rm(commandDir, { recursive: true, force: true });
          const testCommand = asCommand<Record<string, never>, never>(
            {
              name: 'unawaited-burst-then-throw',
              stage: 'test',
              log: silentLog,
              dir: testDir,
            },
            async (_input, context) => {
              burstEntries.forEach((entry) => {
                void context.log.info(entry.message, entry.metadata);
              });
              throw new Error('bad record');
            },
          );

          const error = await getError(() => testCommand({}));
          expect(error.message).toEqual('bad record');

          const logPath = await getOnlyLogPath({ commandDir });
          expect(await getLogMessages({ path: logPath })).toEqual([
            'input',
            ...burstMessages,
            'output.error',
          ]);
          expect((await readFile(logPath, 'utf-8')).trimEnd()).toMatch(/\]$/);
        },
      );
    });

    when(
      'the logic fires log calls without await, then mutates their metadata',
      () => {
        then(
          'the console gets each entry at call time, in call order, and the file holds the metadata as it was at call time',
          async () => {
            const commandDir = `${testDir}/__tmp__/test/call-time-capture`;
            await rm(commandDir, { recursive: true, force: true });
            const consoleRecord: string[] = []; // .note = deliberate mutation: the recorder of console calls
            const recordLog: LogMethods = {
              debug: (message) => void consoleRecord.push(message),
              info: (message) => void consoleRecord.push(message),
              warn: (message) => void consoleRecord.push(message),
              error: (message) => void consoleRecord.push(message),
            };
            const testCommand = asCommand<Record<string, never>, { ok: true }>(
              {
                name: 'call-time-capture',
                stage: 'test',
                log: recordLog,
                dir: testDir,
              },
              async (_input, context) => {
                const record = { status: 'queued' }; // .note = deliberate mutation: proves capture at call time
                void context.log.info('entry.a', { record });
                void context.log.info('entry.b', { step: 2 });
                // the console already holds both, before any append settles
                expect(consoleRecord).toEqual(['input', 'entry.a', 'entry.b']);
                record.status = 'mutated';
                return { ok: true };
              },
            );

            await testCommand({});

            expect(consoleRecord).toEqual([
              'input',
              'entry.a',
              'entry.b',
              'output.result',
              'output.files',
            ]);
            const contents = await readFile(
              await getOnlyLogPath({ commandDir }),
              'utf-8',
            );
            expect(contents).toContain('"status": "queued"');
            expect(contents).not.toContain('"status": "mutated"');
          },
        );
      },
    );

    when('the run dir vanishes mid-run, so the log appends fail', () => {
      then(
        'the caller gets the append failure, loud; no failure is swallowed',
        async () => {
          const commandDir = `${testDir}/__tmp__/test/append-fails`;
          await rm(commandDir, { recursive: true, force: true });
          const testCommand = asCommand<Record<string, never>, { ok: true }>(
            {
              name: 'append-fails',
              stage: 'test',
              log: silentLog,
              dir: testDir,
            },
            async () => {
              await rm(commandDir, { recursive: true, force: true });
              return { ok: true };
            },
          );

          const error = await getError(() => testCommand({}));
          expect(error.message).toContain('ENOENT');
          expect(error.message).toContain('log.json');
          expect(existsSync(commandDir)).toBe(false);
        },
      );
    });

    when(
      'the run dir vanishes mid-run, the logic fires a log without await, then throws',
      () => {
        then(
          'the caller gets the append failure in place of the logic error (the known edge of cell 8); a later command still writes its whole log',
          async () => {
            const commandDir = `${testDir}/__tmp__/test/append-fails-then-throw`;
            const laterDir = `${testDir}/__tmp__/test/after-append-fails`;
            await rm(commandDir, { recursive: true, force: true });
            await rm(laterDir, { recursive: true, force: true });
            const unawaitedErrors: unknown[] = []; // .note = deliberate mutation: holds the unawaited rejection
            const recorder = genRecordLog();
            const thrown = new Error('bad record');
            const testCommand = asCommand<Record<string, never>, never>(
              {
                name: 'append-fails-then-throw',
                stage: 'test',
                log: recorder.log,
                dir: testDir,
              },
              async (_input, context) => {
                await rm(commandDir, { recursive: true, force: true });
                // LogMethods types the call as void; wrap it, so the promise it returns at runtime can be caught
                Promise.resolve(
                  context.log.info('lost.entry', { step: 1 }),
                ).catch((caught: unknown) => void unawaitedErrors.push(caught));
                throw thrown;
              },
            );

            // the seal in `finally` fails last, so its error is the one the caller sees
            const error = await getError(() => testCommand({}));
            expect(error.message).toContain('ENOENT');
            expect(
              asLogSnapshot({ contents: error.message, testDir }),
            ).toMatchSnapshot('caller error');

            // the unawaited log call rejected too; it was not swallowed
            expect(unawaitedErrors).toHaveLength(1);
            expect(String(unawaitedErrors[0])).toMatch(/ENOENT.*log\.json/);

            // the real error still reaches the console, whole, emitted before its append was tried
            const consoleErrorCall = recorder.calls[recorder.calls.length - 1];
            expect(consoleErrorCall).toEqual({
              level: 'error',
              message: 'output.error',
              metadata: {
                error: {
                  name: 'Error',
                  message: 'bad record',
                  stack: thrown.stack,
                },
              },
            });

            // a logger that stringifies metadata (local, aws-lambda) still sees the message and stack
            const consoleErrorLine = JSON.stringify(consoleErrorCall);
            expect(consoleErrorLine).toContain('"message":"bad record"');
            expect(consoleErrorLine).toMatch(
              /"stack":"Error: bad record\\n {4}at /,
            );
            expect(
              asLogSnapshot({ contents: consoleErrorLine, testDir }),
            ).toMatchSnapshot('console');

            // the chain stayed live: a later command writes its whole log
            const laterCommand = asCommand<Record<string, never>, { ok: true }>(
              {
                name: 'after-append-fails',
                stage: 'test',
                log: silentLog,
                dir: testDir,
              },
              async (_input, context) => {
                void context.log.info('later.entry', { step: 1 });
                return { ok: true };
              },
            );
            await laterCommand({});
            const laterLogPath = await getOnlyLogPath({ commandDir: laterDir });
            expect(await getLogMessages({ path: laterLogPath })).toEqual([
              'input',
              'later.entry',
              'output.result',
              'output.files',
            ]);
          },
        );
      },
    );

    when(
      'the run dir vanishes mid-run, then the logic fires a burst without await (cells 21, 22)',
      () => {
        const OUTCOMES = [
          { cell: 21, logic: 'returns' },
          { cell: 22, logic: 'throws' },
        ] as const;
        OUTCOMES.map((outcome) =>
          then(
            `[cell ${outcome.cell}] logic ${outcome.logic}: every append rejects loud, the console holds the burst in order, the caller gets the append failure, and a later command still writes its whole log`,
            async () => {
              const name = `burst-append-fails-${outcome.logic}`;
              const commandDir = `${testDir}/__tmp__/test/${name}`;
              const laterDir = `${testDir}/__tmp__/test/after-${name}`;
              await rm(commandDir, { recursive: true, force: true });
              await rm(laterDir, { recursive: true, force: true });
              const messages = Array.from(
                { length: 20 },
                (_, i) => `entry.${i}`,
              );
              const unawaitedErrors: unknown[] = []; // .note = deliberate mutation: holds each unawaited rejection
              const recorder = genRecordLog();
              const testCommand = asCommand<
                Record<string, never>,
                { ok: true }
              >(
                {
                  name,
                  stage: 'test',
                  log: recorder.log,
                  dir: testDir,
                },
                async (_input, context) => {
                  await rm(commandDir, { recursive: true, force: true });
                  messages.forEach((message, i) => {
                    // LogMethods types the call as void; wrap it, so the promise it returns at runtime can be caught
                    Promise.resolve(
                      context.log.info(message, { step: i }),
                    ).catch(
                      (caught: unknown) => void unawaitedErrors.push(caught),
                    );
                  });
                  if (outcome.logic === 'throws') throw new Error('bad record');
                  return { ok: true };
                },
              );

              // the seal in `finally` fails last, so its error is the one the caller sees
              const error = await getError(() => testCommand({}));
              expect(error.message).toMatch(/ENOENT.*log\.json/);

              // every write of the burst rejected, each with the append failure; none was swallowed
              expect(unawaitedErrors).toHaveLength(messages.length);
              unawaitedErrors.forEach((caught) =>
                expect(String(caught)).toMatch(/ENOENT.*log\.json/),
              );

              // the console got every entry, in call order, before any append was tried
              expect(
                recorder.calls
                  .map((call) => call.message)
                  .filter((message) => message.startsWith('entry.')),
              ).toEqual(messages);

              // the chain stayed live through twenty failures: a later command writes its whole log
              const laterCommand = asCommand<
                Record<string, never>,
                { ok: true }
              >(
                {
                  name: `after-${name}`,
                  stage: 'test',
                  log: silentLog,
                  dir: testDir,
                },
                async (_input, context) => {
                  void context.log.info('later.entry', { step: 1 });
                  return { ok: true };
                },
              );
              await laterCommand({});
              const laterLogPath = await getOnlyLogPath({
                commandDir: laterDir,
              });
              expect(await getLogMessages({ path: laterLogPath })).toEqual([
                'input',
                'later.entry',
                'output.result',
                'output.files',
              ]);
            },
          ),
        );
      },
    );

    when('the logic fires a log after the command has settled', () => {
      then(
        'the console gets it, and the file holds it after `]` (cell 25: no seal guard, so the entry is never hidden)',
        async () => {
          const commandDir = `${testDir}/__tmp__/test/late-entry`;
          await rm(commandDir, { recursive: true, force: true });
          const consoleRecord: string[] = []; // .note = deliberate mutation: the recorder of console calls
          const recordLog: LogMethods = {
            debug: (message) => void consoleRecord.push(message),
            info: (message) => void consoleRecord.push(message),
            warn: (message) => void consoleRecord.push(message),
            error: (message) => void consoleRecord.push(message),
          };
          const contextHeld: { log: LogMethods | null } = { log: null }; // .note = deliberate mutation: holds the context past the run
          const testCommand = asCommand<Record<string, never>, { ok: true }>(
            {
              name: 'late-entry',
              stage: 'test',
              log: recordLog,
              dir: testDir,
            },
            async (_input, context) => {
              contextHeld.log = context.log;
              return { ok: true };
            },
          );

          await testCommand({});
          if (!contextHeld.log)
            throw new Error('the logic did not run; no context was held');
          await contextHeld.log.info('late.entry', { step: 1 });

          expect(consoleRecord[consoleRecord.length - 1]).toEqual('late.entry');
          const logPath = await getOnlyLogPath({ commandDir });
          const contents = await readFile(logPath, 'utf-8');
          expect(contents.indexOf(']\n')).toBeLessThan(
            contents.indexOf('"message": "late.entry"'),
          );
          expect(asLogSnapshot({ contents, testDir })).toMatchSnapshot();
        },
      );
    });

    when(
      'the logic throws an error that carries a circular ref, under a logger that stringifies (cells 28, 41)',
      () => {
        then(
          'the caller gets the real error; the console line and log.json each mark the cycle and keep the message',
          async () => {
            const commandDir = `${testDir}/__tmp__/test/circular-error`;
            await rm(commandDir, { recursive: true, force: true });
            const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
            const thrown = Object.assign(new Error('upstream refused'), {
              request: { url: '/x' } as { url: string; self?: unknown },
            });
            thrown.request.self = thrown.request; // .note = deliberate mutation: an http-client error's request points back at itself
            const testCommand = asCommand<Record<string, never>, never>(
              {
                name: 'circular-error',
                stage: 'test',
                log: genStringifyLog({ lines }),
                dir: testDir,
              },
              () => Promise.reject(thrown),
            );

            // the same error reaches the caller, never a TypeError from the logger
            const error = await getError(() => testCommand({}));
            expect(error).toBe(thrown);

            // the console line holds the message and marks the cycle
            const errorLine = lines[lines.length - 1]!;
            expect(errorLine).toContain('"message":"upstream refused"');
            expect(errorLine).toContain('"self":"[Circular]"');

            const logPath = await getOnlyLogPath({ commandDir });
            expect(await getLogMessages({ path: logPath })).toEqual([
              'input',
              'output.error',
            ]);
            const contents = await readFile(logPath, 'utf-8');
            expect(contents).toContain('"self": "[Circular]"');
            expect(contents.trimEnd()).toMatch(/\]$/);
            expect(asLogSnapshot({ contents, testDir })).toMatchSnapshot(
              'log.json',
            ); // the error entry as a caller reads it
            expect(
              asLogSnapshot({ contents: errorLine, testDir }),
            ).toMatchSnapshot('console');
          },
        );
      },
    );

    when(
      'the input holds a bigint, under a logger that stringifies (cells 29, 41)',
      () => {
        then(
          'the command returns; the console line and log.json mark the bigint as text',
          async () => {
            const commandDir = `${testDir}/__tmp__/test/bigint-input`;
            await rm(commandDir, { recursive: true, force: true });
            const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
            const testCommand = asCommand<{ id: bigint }, { ok: true }>(
              {
                name: 'bigint-input',
                stage: 'test',
                log: genStringifyLog({ lines }),
                dir: testDir,
              },
              async () => ({ ok: true }),
            );

            expect(await testCommand({ id: BigInt(42) })).toEqual({ ok: true });
            expect(lines[0]).toEqual(
              '{"level":"info","message":"input","metadata":{"input":{"id":"42n"}}}',
            );
            const contents = await readFile(
              await getOnlyLogPath({ commandDir }),
              'utf-8',
            );
            expect(contents).toContain('"id": "42n"');
          },
        );
      },
    );

    when(
      'the logic returns a bigint, under a logger that stringifies (cells 30, 41)',
      () => {
        then(
          'the command returns it as is; out.json and the console line mark it as text',
          async () => {
            const commandDir = `${testDir}/__tmp__/test/bigint-output`;
            await rm(commandDir, { recursive: true, force: true });
            const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
            const testCommand = asCommand<
              Record<string, never>,
              { id: bigint }
            >(
              {
                name: 'bigint-output',
                stage: 'test',
                log: genStringifyLog({ lines }),
                dir: testDir,
              },
              async () => ({ id: BigInt(42) }),
            );

            expect(await testCommand({})).toEqual({ id: BigInt(42) });
            expect(lines[1]).toEqual(
              '{"level":"info","message":"output.result","metadata":{"output":{"id":"42n"}}}',
            );
            const logPath = await getOnlyLogPath({ commandDir });
            const outPath = logPath.replace(/log\.json$/, 'out.json');
            expect(await readFile(outPath, 'utf-8')).toContain('"id": "42n"');
          },
        );
      },
    );

    when('two commands fire bursts without await, at once', () => {
      then(
        'each log holds its own burst in its own order, sealed by its own `]`',
        async () => {
          const names = ['parallel-burst-a', 'parallel-burst-b'];
          await Promise.all(
            names.map((name) =>
              rm(`${testDir}/__tmp__/test/${name}`, {
                recursive: true,
                force: true,
              }),
            ),
          );
          const commands = names.map((name) =>
            asCommand<Record<string, never>, { ok: true }>(
              { name, stage: 'test', log: silentLog, dir: testDir },
              async (_input, context) => {
                burstEntries.forEach((entry) => {
                  void context.log.info(entry.message, entry.metadata);
                });
                return { ok: true };
              },
            ),
          );

          await Promise.all(commands.map((command) => command({})));

          for (const name of names) {
            const logPath = await getOnlyLogPath({
              commandDir: `${testDir}/__tmp__/test/${name}`,
            });
            expect(await getLogMessages({ path: logPath })).toEqual([
              'input',
              ...burstMessages,
              'output.result',
              'output.files',
            ]);
            const contents = await readFile(logPath, 'utf-8');
            expect(contents.startsWith('[\n')).toBe(true); // `[` lands first
            expect(contents.trimEnd()).toMatch(/\]$/); // `]` lands last
          }
        },
      );
    });
  });
});
