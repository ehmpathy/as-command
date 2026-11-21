import { given, then, when } from 'test-fns';

import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * .what = reads the names a package manifest asks an adopter to install
 * .why = an adopter installs `dependencies`, may install `optionalDependencies`, and must
 *        supply `peerDependencies`; any of the three can carry bottleneck into its graph
 */
const getManifestEdges = async (input: {
  dir: string;
}): Promise<{ required: string[]; elective: string[] }> => {
  const manifest = JSON.parse(
    await readFile(join(input.dir, 'package.json'), 'utf-8'),
  );
  return {
    required: Object.keys(manifest.dependencies ?? {}),
    elective: [
      ...Object.keys(manifest.optionalDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ],
  };
};

/**
 * .what = finds the installed dir of a package, as node would from a given dir
 * .why = pnpm nests each package's deps beside its real path, so the walk starts there
 */
const getInstalledDir = (input: {
  name: string;
  fromDir: string;
}): string | null => {
  const candidate = join(input.fromDir, 'node_modules', input.name);
  if (existsSync(join(candidate, 'package.json')))
    return realpathSync(candidate);
  const parent = dirname(input.fromDir);
  if (parent === input.fromDir) return null;
  return getInstalledDir({ name: input.name, fromDir: parent });
};

/**
 * .what = walks the prod graph an adopter installs, and returns every package name it reaches
 * .why = the property the wish asks for is "bottleneck is not reachable", not a proxy of it
 */
const getProdGraphNames = async (input: {
  dir: string;
  seen: Set<string>; // .note = deliberate mutation: the walk's visited set
}): Promise<Set<string>> => {
  const edges = await getManifestEdges({ dir: input.dir });
  for (const name of [...edges.required, ...edges.elective]) {
    if (input.seen.has(name)) continue;
    input.seen.add(name);
    const installedDir = getInstalledDir({ name, fromDir: input.dir });

    // a required dep that is not installed means the walk cannot vouch for the graph
    if (!installedDir && edges.required.includes(name))
      throw new Error(
        `prod dependency '${name}' is not installed beside '${input.dir}'; run pnpm install, then retry`,
      );

    // an absent elective dep is an adopter's choice; its name was still checked above
    if (!installedDir) continue;
    await getProdGraphNames({ dir: installedDir, seen: input.seen });
  }
  return input.seen;
};

describe('dependencies (integration)', () => {
  const rootDir = join(__dirname, '..');

  given('the as-command package manifest', () => {
    when('an adopter installs as-command for prod', () => {
      then('bottleneck is not a dependency', async () => {
        const edges = await getManifestEdges({ dir: rootDir });
        expect([...edges.required, ...edges.elective]).not.toContain(
          'bottleneck',
        );
      });

      then(
        'bottleneck is not reachable anywhere in the prod graph, so its require cycle cannot reach an adopter',
        async () => {
          const names = await getProdGraphNames({
            dir: rootDir,
            seen: new Set(),
          });
          expect(names.size).toBeGreaterThan(0); // the walk reached the graph
          expect([...names]).not.toContain('bottleneck');
        },
      );
    });
  });
});
