import { given, then, when } from 'test-fns';

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * .what = a node program that fires a failed task with no await, then a next task
 * .why = only a real process shows what node does with a rejection no caller awaits;
 *        jest sandboxes `process`, so an in-test listener never sees it
 */
const PROGRAM_UNAWAITED_FAILURE = `
  const { scheduleFileLog } = require('./src/scheduleFileLog');
  void scheduleFileLog({ task: async () => { throw new Error('ENOENT: log.json'); } });
  void scheduleFileLog({ task: async () => { console.log('next.ran'); } });
`;

describe('scheduleFileLog (integration)', () => {
  given('a task that fails, which no caller awaits', () => {
    when('the process runs it, then a next task', () => {
      then(
        'the rejection surfaces loud with its cause, and the next task still ran',
        () => {
          // run the program once, in a real node process
          const result = spawnSync(
            process.execPath,
            ['--require', 'esbuild-register', '-e', PROGRAM_UNAWAITED_FAILURE],
            { cwd: join(__dirname, '..'), encoding: 'utf-8' },
          );

          // loud: the process exits non-zero and names the cause
          expect(result.status).not.toEqual(0);
          expect(result.stderr).toContain('ENOENT: log.json');

          // live: the chain still ran the next task
          expect(result.stdout).toContain('next.ran');
        },
      );
    });
  });
});
