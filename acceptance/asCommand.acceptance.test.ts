import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateLogMethods, LogLevel } from 'simple-leveled-log-methods';
import { given, then, when } from 'test-fns';

// blackbox: the built package, as an adopter imports it (npm run build precedes this suite)
import { asCommand } from '../dist';

/**
 * .what = walks the require graph of the build from an entry file, as dpdm does
 * .why = an adopter's dpdm follows requires from the package entry; the walk returns every
 *        file it reaches and every package it requires by name
 * .note = deliberate mutation: `seen` and `packages` are the walk's own accumulators
 */
const getRequireGraph = async (input: {
  file: string;
  seen: Set<string>;
  packages: Set<string>;
}): Promise<{ files: Set<string>; packages: Set<string> }> => {
  if (input.seen.has(input.file))
    return { files: input.seen, packages: input.packages };
  input.seen.add(input.file);
  const source = await readFile(input.file, 'utf-8');
  const targets = [...source.matchAll(/require\("([^"]+)"\)/g)].map(
    (match) => match[1]!,
  );
  for (const target of targets) {
    // a bare name is a package; record its root name (`@scope/name` or `name`)
    if (!target.startsWith('.')) {
      input.packages.add(
        target.startsWith('@')
          ? target.split('/').slice(0, 2).join('/')
          : target.split('/')[0]!,
      );
      continue;
    }

    // a relative path is a file of the build; follow it
    const next = join(dirname(input.file), target);
    await getRequireGraph({
      file: next.endsWith('.js') ? next : `${next}.js`,
      seen: input.seen,
      packages: input.packages,
    });
  }
  return { files: input.seen, packages: input.packages };
};

/**
 * .what = masks the per-run fields of a log.json, so its shape can be snapped
 * .why = timestamps, the run id, the absolute test dir, and an error's stack differ on every run
 *        and host; all else in the file is the contract an adopter reads
 */
const asLogSnapshot = (input: { contents: string; testDir: string }) =>
  input.contents
    .replace(/"timestamp": "[^"]+"/g, '"timestamp": "<timestamp>"')
    .replace(/"stack":( ?)"(?:[^"\\]|\\.)*"/g, '"stack":$1"<stack>"') // pretty (log.json) or compact (a console line)
    .split(input.testDir)
    .join('<testDir>')
    .replace(/\d{8}\.\d{6}\.[0-9a-f]{64}/g, '<runId>');

/**
 * .what = reads the only run dir of a command, after its run dir was cleared
 * .why = each journey clears its command dir first, so one run dir exists
 */
const getOnlyRunDir = async (input: { commandDir: string }) => {
  const runDirs = await readdir(input.commandDir);
  expect(runDirs).toHaveLength(1);
  return join(input.commandDir, runDirs[0]!);
};

/**
 * .what = asserts every entry's timestamp is an iso utc instant
 * .why = the snapshot masks timestamps, so their format is checked here, before the mask
 */
const expectIsoTimestamps = (input: { contents: string }) => {
  const timestamps = [
    ...input.contents.matchAll(/"timestamp": "([^"]*)"/g),
  ].map((match) => match[1]);
  expect(timestamps.length).toBeGreaterThan(0);
  timestamps.forEach((timestamp) =>
    expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  );
};

// a logger that emits naught, for journeys whose console output is not under test
const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * .what = a logger that stringifies each call, as simple-leveled-log-methods does in local and aws-lambda
 * .why = shows what an adopter's console and cloudwatch actually receive
 * .note = deliberate mutation: pushes each line onto the caller's array
 */
const genStringifyLog = (input: { lines: string[] }) => {
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

describe('as-command (acceptance)', () => {
  const distDir = join(__dirname, '..', 'dist');
  const testDir = join(__dirname, '.temp');

  given('the built package an adopter installs', () => {
    when(
      'its require graph is walked from the package entry, as dpdm does',
      () => {
        then('no file in the graph requires bottleneck', async () => {
          const graph = await getRequireGraph({
            file: join(distDir, 'index.js'),
            seen: new Set(),
            packages: new Set(),
          });
          expect(graph.files.size).toBeGreaterThan(1); // the walk reached past the entry
          expect([...graph.packages]).not.toContain('bottleneck');
          // node builtins plus date-fns: the whole prod surface an adopter's dpdm will trace
          expect([...graph.packages].sort()).toEqual([
            'crypto',
            'date-fns',
            'fs',
            'path',
          ]);
          expect([...graph.packages].sort()).toMatchSnapshot('prod packages'); // the prod surface, for review
        });
      },
    );

    when(
      'dpdm traces the package entry, as the adopter lint practice runs it (exclude empty, so node_modules is walked)',
      () => {
        then(
          'it finds no circular import, reaches into date-fns, and never reaches bottleneck',
          async () => {
            // the practice's own flags; `--exclude ""` is what it passes when .dpdmrc.yaml lists none
            const outputPath = join(testDir, 'dpdm.output.json');
            const run = spawnSync(
              process.execPath,
              [
                join(
                  dirname(require.resolve('dpdm/package.json')),
                  'lib/bin/dpdm.js',
                ),
                '--no-warning',
                '--no-tree',
                '--exit-code',
                'circular:1',
                '--exclude',
                '',
                '--output',
                outputPath,
                'dist/index.js',
              ],
              { cwd: join(__dirname, '..'), encoding: 'utf-8' },
            );
            expect(run.status).toEqual(0); // the adopter's lint gate passes

            const report = JSON.parse(await readFile(outputPath, 'utf-8')) as {
              tree: Record<string, unknown>;
              circulars: string[][];
            }; // .note = dpdm's documented `--output` shape: { entries, tree, circulars }
            const files = Object.keys(report.tree);
            expect(files.some((file) => file.includes('date-fns'))).toBe(true); // the walk crossed into node_modules
            expect(files.filter((file) => file.includes('bottleneck'))).toEqual(
              [],
            );
            expect(report.circulars).toEqual([]);
          },
        );
      },
    );

    when('a command fires a burst of log calls without await', () => {
      then(
        'its log.json holds every entry in call order, sealed by the close bracket — across repeated bursts',
        async () => {
          // the integration clamp's shape: unserialized appends of this burst reorder in most runs
          const messages = Array.from({ length: 100 }, (_, i) => `entry.${i}`);
          for (const run of Array.from({ length: 5 }, (_, i) => i)) {
            const name = `burst-${run}`;
            const commandDir = join(testDir, '__tmp__', 'test', name);
            await rm(commandDir, { recursive: true, force: true });
            const command = asCommand<Record<string, never>, { ok: true }>(
              {
                name,
                stage: 'test',
                dir: testDir,
                log: {
                  debug: () => {},
                  info: () => {},
                  warn: () => {},
                  error: () => {},
                },
              },
              async (_input, context) => {
                messages.forEach((message, i) => {
                  void context.log.info(message, {
                    pad: 'x'.repeat((100 - i) * 256),
                  });
                });
                return { ok: true };
              },
            );

            await command({});

            const runDirs = await readdir(commandDir);
            expect(runDirs).toHaveLength(1);
            const contents = await readFile(
              join(commandDir, runDirs[0]!, 'log.json'),
              'utf-8',
            );
            const logged = [
              ...contents.matchAll(/^ {2}"message": "(.*)",?$/gm),
            ].map((match) => match[1]);
            expect(logged).toEqual([
              'input',
              ...messages,
              'output.result',
              'output.files',
            ]);
            expect(contents.trimEnd()).toMatch(/\]$/);
          }
        },
      );
    });

    when('a command logs at two levels, then returns', () => {
      then(
        'the caller gets the output; the console, log.json, and out.json each hold the contract shape',
        async () => {
          const commandDir = join(
            testDir,
            '__tmp__',
            'test',
            'journey-returns',
          );
          await rm(commandDir, { recursive: true, force: true });
          const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
          const command = asCommand<{ name: string }, { greeted: string }>(
            {
              name: 'journey-returns',
              stage: 'test',
              dir: testDir,
              log: genStringifyLog({ lines }),
            },
            async (input, context) => {
              await context.log.info('greet.began', { name: input.name });
              void context.log.warn('greet.slow', { ms: 1200 });
              return { greeted: input.name };
            },
          );

          const output = await command({ name: 'kai' });
          expect(output).toEqual({ greeted: 'kai' });

          // the console got each call, in call order
          expect(
            lines.map(
              (line) => (JSON.parse(line) as { message: string }).message,
            ),
          ).toEqual([
            'input',
            'greet.began',
            'greet.slow',
            'output.result',
            'output.files',
          ]);

          const runDir = await getOnlyRunDir({ commandDir });
          const logContents = await readFile(join(runDir, 'log.json'), 'utf-8');
          const outContents = await readFile(join(runDir, 'out.json'), 'utf-8');
          expect(outContents).toEqual('{\n  "greeted": "kai"\n}');
          expect(logContents.trimEnd()).toMatch(/\]$/);
          expectIsoTimestamps({ contents: logContents }); // checked before the mask hides them

          // the comma before `]` is main's byte format, kept on purpose (fulcrum F07)
          expect(
            asLogSnapshot({ contents: logContents, testDir }),
          ).toMatchSnapshot('log.json');
          expect(outContents).toMatchSnapshot('out.json');
          expect(
            asLogSnapshot({ contents: lines.join('\n'), testDir }),
          ).toMatchSnapshot('console');
        },
      );
    });

    when('a command logs, then throws', () => {
      then(
        'the caller gets the real error; log.json holds output.error with its name, message, and stack, then the close bracket; no out.json',
        async () => {
          const commandDir = join(testDir, '__tmp__', 'test', 'journey-throws');
          await rm(commandDir, { recursive: true, force: true });
          const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
          const command = asCommand<{ name: string }, never>(
            {
              name: 'journey-throws',
              stage: 'test',
              dir: testDir,
              log: genStringifyLog({ lines }),
            },
            async (input, context) => {
              await context.log.info('greet.began', { name: input.name });
              throw new Error('greeter offline');
            },
          );

          const caught = await command({ name: 'kai' }).then(
            () => null,
            (reason: unknown) => reason,
          );
          expect(caught).toEqual(new Error('greeter offline'));

          const runDir = await getOnlyRunDir({ commandDir });
          const logContents = await readFile(join(runDir, 'log.json'), 'utf-8');
          expect(logContents).toContain('"message": "output.error"');
          expect(logContents).toContain('"name": "Error"');
          expect(logContents).toMatch(/"stack": "Error: greeter offline\\n/);
          expect(logContents.trimEnd()).toMatch(/\]$/);
          expectIsoTimestamps({ contents: logContents });

          // a failed run writes no output, so no out.json and no output.files entry point at one
          expect(await readdir(runDir)).toEqual(['log.json']);
          expect(logContents).not.toContain('"message": "output.files"');

          // the console line a human reads in a terminal or cloudwatch holds the message and stack
          const errorLine = lines[lines.length - 1]!;
          expect(errorLine).toContain('"message":"greeter offline"');
          expect(errorLine).toMatch(/"stack":"Error: greeter offline\\n/);

          // the comma before `]` is main's byte format, kept on purpose (fulcrum F07)
          expect(
            asLogSnapshot({ contents: logContents, testDir }),
          ).toMatchSnapshot('log.json');
          expect(
            asLogSnapshot({ contents: lines.join('\n'), testDir }),
          ).toMatchSnapshot('console');
        },
      );
    });

    when(
      'a command fires a burst of log calls without await, then throws',
      () => {
        then(
          'the caller gets the real error; log.json holds the burst in call order, then output.error, then the close bracket — across repeated bursts',
          async () => {
            // the same shape as the burst that returns: unserialized appends of this burst reorder in most runs
            const messages = Array.from(
              { length: 100 },
              (_, i) => `entry.${i}`,
            );
            for (const run of Array.from({ length: 5 }, (_, i) => i)) {
              const name = `journey-burst-throws-${run}`;
              const commandDir = join(testDir, '__tmp__', 'test', name);
              await rm(commandDir, { recursive: true, force: true });
              const command = asCommand<Record<string, never>, never>(
                { name, stage: 'test', dir: testDir, log: silentLog },
                async (_input, context) => {
                  messages.forEach((message, i) => {
                    void context.log.info(message, {
                      pad: 'x'.repeat((100 - i) * 256),
                    });
                  });
                  throw new Error('burst failed');
                },
              );

              const caught = await command({}).then(
                () => null,
                (reason: unknown) => reason,
              );
              expect(caught).toEqual(new Error('burst failed'));

              const runDir = await getOnlyRunDir({ commandDir });
              const logContents = await readFile(
                join(runDir, 'log.json'),
                'utf-8',
              );
              const logged = [
                ...logContents.matchAll(/^ {2}"message": "(.*)",?$/gm),
              ].map((match) => match[1]);
              expect(logged).toEqual(['input', ...messages, 'output.error']);
              expect(logContents.trimEnd()).toMatch(/\]$/);
            }
          },
        );
      },
    );

    when(
      'the run dir vanishes mid-run, under a logger that stringifies metadata (as local and aws-lambda do)',
      () => {
        then(
          'the caller sees the failed append; the unawaited write rejects loud; the console line still holds the real error message',
          async () => {
            const commandDir = join(
              testDir,
              '__tmp__',
              'test',
              'journey-append-fails',
            );
            await rm(commandDir, { recursive: true, force: true });
            const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
            const unawaitedErrors: unknown[] = []; // .note = deliberate mutation: holds the unawaited rejection
            const stringifyLog = genStringifyLog({ lines });
            const command = asCommand<Record<string, never>, never>(
              {
                name: 'journey-append-fails',
                stage: 'test',
                dir: testDir,
                log: stringifyLog,
              },
              async (_input, context) => {
                await rm(commandDir, { recursive: true, force: true });
                // LogMethods types the call as void; wrap it, so the promise it returns at runtime can be caught
                Promise.resolve(
                  context.log.info('lost.entry', { step: 1 }),
                ).catch((reason: unknown) => void unawaitedErrors.push(reason));
                throw new Error('bad record');
              },
            );

            const caught = await command({}).then(
              () => null,
              (reason: unknown) => reason,
            );
            expect(String(caught)).toMatch(/ENOENT.*log\.json/); // the seal fails last, so its error reaches the caller
            expect(unawaitedErrors).toHaveLength(1);
            expect(String(unawaitedErrors[0])).toMatch(/ENOENT.*log\.json/);

            const errorLine = lines[lines.length - 1]!;
            expect(errorLine).toContain('"message":"output.error"');
            expect(errorLine).toContain('"message":"bad record"');
            expect(errorLine).toMatch(/"stack":"Error: bad record\\n/);
            expect(
              asLogSnapshot({ contents: String(caught), testDir }),
            ).toMatchSnapshot('caller error'); // the message an adopter sees in place of the logic error (cell 8's edge)
            expect(
              asLogSnapshot({ contents: errorLine, testDir }),
            ).toMatchSnapshot('console');

            // the chain stays live: the next command's log lands whole and sealed
            const laterDir = join(
              testDir,
              '__tmp__',
              'test',
              'journey-append-fails-later',
            );
            await rm(laterDir, { recursive: true, force: true });
            const later = asCommand<Record<string, never>, { ok: true }>(
              {
                name: 'journey-append-fails-later',
                stage: 'test',
                dir: testDir,
                log: silentLog,
              },
              async () => ({ ok: true }),
            );
            expect(await later({})).toEqual({ ok: true });
            const laterLog = await readFile(
              join(await getOnlyRunDir({ commandDir: laterDir }), 'log.json'),
              'utf-8',
            );
            expect(laterLog).toContain('"message": "output.files"');
            expect(laterLog.trimEnd()).toMatch(/\]$/);
          },
        );
      },
    );

    when('a command writes a nested out file, then returns a string', () => {
      then(
        'the caller gets the string and the path; the file holds its bytes; out.json holds the string as is',
        async () => {
          const commandDir = join(
            testDir,
            '__tmp__',
            'test',
            'journey-out-string',
          );
          await rm(commandDir, { recursive: true, force: true });
          const command = asCommand<Record<string, never>, string>(
            {
              name: 'journey-out-string',
              stage: 'test',
              dir: testDir,
              log: silentLog,
            },
            async (_input, context) => {
              const { path } = await context.out.write({
                name: 'reports/2026/summary.csv',
                data: 'spot,waves\ntrestles,6\n',
              });
              return `saved ${path.split('/').slice(-3).join('/')}`;
            },
          );

          const output = await command({});
          expect(output).toEqual('saved reports/2026/summary.csv');

          const runDir = await getOnlyRunDir({ commandDir });
          expect(
            await readFile(join(runDir, 'reports/2026/summary.csv'), 'utf-8'),
          ).toEqual('spot,waves\ntrestles,6\n');
          const outContents = await readFile(join(runDir, 'out.json'), 'utf-8');
          expect(outContents).toEqual('saved reports/2026/summary.csv');
          expect(outContents).toMatchSnapshot('out.json');
        },
      );
    });

    when('a command returns undefined', () => {
      then(
        'the caller gets undefined; out.json holds the word undefined',
        async () => {
          const commandDir = join(
            testDir,
            '__tmp__',
            'test',
            'journey-undefined',
          );
          await rm(commandDir, { recursive: true, force: true });
          const command = asCommand<Record<string, never>, undefined>(
            {
              name: 'journey-undefined',
              stage: 'test',
              dir: testDir,
              log: silentLog,
            },
            async () => undefined,
          );

          expect(await command({})).toBeUndefined();
          const runDir = await getOnlyRunDir({ commandDir });
          const outContents = await readFile(join(runDir, 'out.json'), 'utf-8');
          expect(outContents).toEqual('undefined');
          expect(outContents).toMatchSnapshot('out.json'); // main's byte format: the bare word, not json (F07's dream covers it)
        },
      );
    });

    when('a command throws a value that is not an Error', () => {
      then(
        'the caller gets the same value; log.json holds it whole as output.error, sealed by the close bracket',
        async () => {
          const commandDir = join(
            testDir,
            '__tmp__',
            'test',
            'journey-throws-plain',
          );
          await rm(commandDir, { recursive: true, force: true });
          const thrown = { code: 'E_QUOTA', detail: 'daily cap reached' };
          const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
          const command = asCommand<Record<string, never>, never>(
            {
              name: 'journey-throws-plain',
              stage: 'test',
              dir: testDir,
              log: genStringifyLog({ lines }),
            },
            () => Promise.reject(thrown),
          );

          const caught = await command({}).then(
            () => null,
            (reason: unknown) => reason,
          );
          expect(caught).toBe(thrown);

          const runDir = await getOnlyRunDir({ commandDir });
          const logContents = await readFile(join(runDir, 'log.json'), 'utf-8');
          expect(logContents).toContain('"message": "output.error"');
          expect(logContents).toContain('"code": "E_QUOTA"');
          expect(logContents.trimEnd()).toMatch(/\]$/);
          expect(lines[lines.length - 1]).toEqual(
            '{"level":"error","message":"output.error","metadata":{"error":{"code":"E_QUOTA","detail":"daily cap reached"}}}',
          );

          // the comma before `]` is main's byte format, kept on purpose (fulcrum F07)
          expectIsoTimestamps({ contents: logContents });
          expect(
            asLogSnapshot({ contents: logContents, testDir }),
          ).toMatchSnapshot('log.json');
          expect(lines[lines.length - 1]).toMatchSnapshot('console');
        },
      );
    });

    when(
      'a command throws an error that holds a circular ref, under a logger that stringifies metadata',
      () => {
        then(
          'the caller gets the real error, never a TypeError from the logger; the console line and log.json mark the cycle and keep the message',
          async () => {
            const commandDir = join(
              testDir,
              '__tmp__',
              'test',
              'journey-throws-circular',
            );
            await rm(commandDir, { recursive: true, force: true });
            const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
            const error = Object.assign(new Error('socket hang up'), {
              request: {} as { self?: unknown },
            });
            error.request.self = error.request; // .note = deliberate mutation: an http-client error's request points back at itself
            const command = asCommand<Record<string, never>, never>(
              {
                name: 'journey-throws-circular',
                stage: 'test',
                dir: testDir,
                log: genStringifyLog({ lines }),
              },
              () => Promise.reject(error),
            );

            const caught = await command({}).then(
              () => null,
              (reason: unknown) => reason,
            );
            expect(caught).toBe(error);

            const errorLine = lines[lines.length - 1]!;
            expect(errorLine).toContain('"message":"socket hang up"');
            expect(errorLine).toContain('"self":"[Circular]"');

            const runDir = await getOnlyRunDir({ commandDir });
            const logContents = await readFile(
              join(runDir, 'log.json'),
              'utf-8',
            );
            expect(logContents).toContain('"message": "socket hang up"');
            expect(logContents).toContain('"self": "[Circular]"');
            expect(logContents.trimEnd()).toMatch(/\]$/);
            expectIsoTimestamps({ contents: logContents });
            expect(
              asLogSnapshot({ contents: logContents, testDir }),
            ).toMatchSnapshot('log.json');
            expect(
              asLogSnapshot({ contents: errorLine, testDir }),
            ).toMatchSnapshot('console');
          },
        );
      },
    );

    when(
      'commands run under the real simple-leveled-log-methods logger, which stringifies metadata (cells 28, 30, 41)',
      () => {
        then(
          'a circular error reaches the caller whole, a bigint output returns as is, and the console holds both marked',
          async () => {
            const names = [
              'journey-real-log-circular',
              'journey-real-log-bigint',
            ];
            await Promise.all(
              names.map((name) =>
                rm(join(testDir, '__tmp__', 'test', name), {
                  recursive: true,
                  force: true,
                }),
              ),
            );
            const log = generateLogMethods({ minimalLogLevel: LogLevel.DEBUG });
            const spyWarn = jest.spyOn(console, 'warn'); // .note = a spy, never a mock: the real logger still writes
            const spyLog = jest.spyOn(console, 'log');
            try {
              // a circular error, as an http client throws it
              const error = Object.assign(new Error('socket hang up'), {
                request: {} as { self?: unknown },
              });
              error.request.self = error.request; // .note = deliberate mutation: builds the cycle
              const commandThrows = asCommand<Record<string, never>, never>(
                { name: names[0]!, stage: 'test', dir: testDir, log },
                () => Promise.reject(error),
              );
              const caught = await commandThrows({}).then(
                () => null,
                (reason: unknown) => reason,
              );
              expect(caught).toBe(error);
              const errorCall = spyWarn.mock.calls
                .map((call) => call[0] as { message: string; metadata: string })
                .find((entry) => entry.message === 'output.error');
              expect(errorCall?.metadata).toContain(
                '"message":"socket hang up"',
              );
              expect(errorCall?.metadata).toContain('"self":"[Circular]"');

              // a bigint output
              const commandBigint = asCommand<
                Record<string, never>,
                { id: bigint }
              >(
                { name: names[1]!, stage: 'test', dir: testDir, log },
                async () => ({ id: BigInt(42) }),
              );
              expect(await commandBigint({})).toEqual({ id: BigInt(42) });
              const resultCall = spyLog.mock.calls
                .map((call) => call[0] as { message: string; metadata: string })
                .find((entry) => entry.message === 'output.result');
              expect(resultCall?.metadata).toEqual('{"output":{"id":"42n"}}');
              const runDir = await getOnlyRunDir({
                commandDir: join(testDir, '__tmp__', 'test', names[1]!),
              });
              expect(
                await readFile(join(runDir, 'out.json'), 'utf-8'),
              ).toContain('"id": "42n"');
            } finally {
              spyWarn.mockRestore();
              spyLog.mockRestore();
            }
          },
        );
      },
    );

    when(
      'a command fires log calls without await, then mutates their metadata (cell 31)',
      () => {
        then(
          'log.json and the console each hold the metadata as it was at the call',
          async () => {
            const commandDir = join(
              testDir,
              '__tmp__',
              'test',
              'journey-mutate',
            );
            await rm(commandDir, { recursive: true, force: true });
            const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
            const command = asCommand<Record<string, never>, { ok: true }>(
              {
                name: 'journey-mutate',
                stage: 'test',
                dir: testDir,
                log: genStringifyLog({ lines }),
              },
              async (_input, context) => {
                const job = { status: 'queued' };
                void context.log.info('job.seen', { job });
                job.status = 'mutated'; // .note = deliberate mutation: the change the log must not see
                return { ok: true };
              },
            );

            expect(await command({})).toEqual({ ok: true });
            expect(lines[1]).toEqual(
              '{"level":"info","message":"job.seen","metadata":{"job":{"status":"queued"}}}',
            );
            const runDir = await getOnlyRunDir({ commandDir });
            const logContents = await readFile(
              join(runDir, 'log.json'),
              'utf-8',
            );
            expect(logContents).toContain('"status": "queued"');
            expect(logContents).not.toContain('"status": "mutated"');
            expectIsoTimestamps({ contents: logContents });
            expect(
              asLogSnapshot({ contents: logContents, testDir }),
            ).toMatchSnapshot('log.json');
            expect(
              asLogSnapshot({ contents: lines.join('\n'), testDir }),
            ).toMatchSnapshot('console');
          },
        );
      },
    );

    when('two commands fire bursts without await, at once (case=4)', () => {
      then(
        'each log holds its own burst in its own order, sealed by its own close bracket',
        async () => {
          const names = ['journey-parallel-a', 'journey-parallel-b'];
          const messages = Array.from({ length: 50 }, (_, i) => `entry.${i}`);
          await Promise.all(
            names.map((name) =>
              rm(join(testDir, '__tmp__', 'test', name), {
                recursive: true,
                force: true,
              }),
            ),
          );
          const commands = names.map((name) =>
            asCommand<Record<string, never>, { ok: true }>(
              { name, stage: 'test', dir: testDir, log: silentLog },
              async (_input, context) => {
                messages.forEach((message, i) => {
                  void context.log.info(`${name}.${message}`, {
                    pad: 'x'.repeat((50 - i) * 256),
                  });
                });
                return { ok: true };
              },
            ),
          );

          await Promise.all(commands.map((command) => command({})));

          for (const name of names) {
            const runDir = await getOnlyRunDir({
              commandDir: join(testDir, '__tmp__', 'test', name),
            });
            const logContents = await readFile(
              join(runDir, 'log.json'),
              'utf-8',
            );
            const logged = [
              ...logContents.matchAll(/^ {2}"message": "(.*)",?$/gm),
            ].map((match) => match[1]);
            expect(logged).toEqual([
              'input',
              ...messages.map((message) => `${name}.${message}`),
              'output.result',
              'output.files',
            ]);
            expect(logContents.trimEnd()).toMatch(/\]$/);
          }
        },
      );
    });

    when('a command logs after it has returned (cell 25)', () => {
      then(
        'the late entry still lands in log.json, after the close bracket, and reaches the console',
        async () => {
          const commandDir = join(testDir, '__tmp__', 'test', 'journey-late');
          await rm(commandDir, { recursive: true, force: true });
          const lines: string[] = []; // .note = deliberate mutation: the console lines, as an adopter logger emits them
          const lateLogs: Promise<void>[] = []; // .note = deliberate mutation: holds the late call, so the test can await it
          const command = asCommand<Record<string, never>, { ok: true }>(
            {
              name: 'journey-late',
              stage: 'test',
              dir: testDir,
              log: genStringifyLog({ lines }),
            },
            async (_input, context) => {
              // LogMethods types the call as void; wrap it, so the promise it returns at runtime can be awaited
              lateLogs.push(
                new Promise<void>((ok) => setTimeout(ok, 50)).then(() =>
                  Promise.resolve(context.log.info('late.entry', { step: 1 })),
                ),
              );
              return { ok: true };
            },
          );

          expect(await command({})).toEqual({ ok: true });
          await Promise.all(lateLogs);

          expect(lines[lines.length - 1]).toContain('"message":"late.entry"');
          const runDir = await getOnlyRunDir({ commandDir });
          const logContents = await readFile(join(runDir, 'log.json'), 'utf-8');
          expect(logContents.indexOf(']\n')).toBeLessThan(
            logContents.indexOf('"message": "late.entry"'),
          );
          expect(
            asLogSnapshot({ contents: logContents, testDir }),
          ).toMatchSnapshot('log.json'); // F07: the comma before the close bracket is main's byte format
        },
      );
    });
  });
});
