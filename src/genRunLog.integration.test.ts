import { given, then, when } from 'test-fns';

import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { genRunLog } from './genRunLog';

describe('genRunLog (integration)', () => {
  const testDir = join(__dirname, '.temp/genRunLog');

  given('a run log on a fresh file', () => {
    when('it is opened, sent two entries without await, then sealed', () => {
      then(
        'the file holds `[`, both entries in call order, then `]`',
        async () => {
          await rm(testDir, { recursive: true, force: true });
          await mkdir(testDir, { recursive: true });
          const path = join(testDir, 'once.log.json');
          const runLog = genRunLog({ path });

          await runLog.open();
          void runLog.append({
            level: 'info',
            timestamp: '2026-11-14T00:00:00.000Z',
            message: 'entry.a',
            metadata: { pad: 'x'.repeat(64 * 1024) }, // larger first, so an unserialized append would reorder
          });
          void runLog.append({
            level: 'info',
            timestamp: '2026-11-14T00:00:00.000Z',
            message: 'entry.b',
            metadata: undefined,
          });
          await runLog.seal();

          const contents = await readFile(path, 'utf-8');
          expect(contents.startsWith('[\n')).toBe(true);
          expect(contents.indexOf('"entry.a"')).toBeLessThan(
            contents.indexOf('"entry.b"'),
          );
          expect(contents.endsWith('},\n]\n')).toBe(true);
        },
      );
    });

    when('open and seal are each called twice', () => {
      then(
        'the file holds one `[` and one `]`: a repeat converges',
        async () => {
          await rm(testDir, { recursive: true, force: true });
          await mkdir(testDir, { recursive: true });
          const path = join(testDir, 'twice.log.json');
          const runLog = genRunLog({ path });

          await runLog.open();
          await runLog.open();
          await runLog.append({
            level: 'info',
            timestamp: '2026-11-14T00:00:00.000Z',
            message: 'entry.a',
            metadata: { step: 1 },
          });
          await runLog.seal();
          await runLog.seal();

          expect(await readFile(path, 'utf-8')).toEqual(
            '[\n{\n  "level": "info",\n  "timestamp": "2026-11-14T00:00:00.000Z",\n  "message": "entry.a",\n  "metadata": {\n    "step": 1\n  }\n},\n]\n',
          );
        },
      );
    });
  });
});
