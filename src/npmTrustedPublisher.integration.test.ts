import { ConstraintError } from 'helpful-errors';
import { genTempDir, getError, given, then, useThen, when } from 'test-fns';
import { parse, stringify } from 'yaml';

import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

/**
 * .what = derives, from the repo, the four values the npm trusted-publisher record must hold,
 *         and checks the live npm registry for the half of the contract it shows without a key
 * .why = the trust record itself is readable only by a package maintainer on npmjs.com; this pins
 *        the repo half, so a workflow change that would orphan the record goes red here, not at the next tag
 * .note = the workflow files are owned by the declapract practice; a red here after an upgrade
 *         means the npm record must change to match, not that the upgrade is wrong
 */
const REPO_ROOT = join(__dirname, '..');
const PUBLISH_REUSABLE = './.github/workflows/.publish-npm.yml';
const PACKAGE_NAME = '@ehmpathy/as-command';
const REGISTRY = 'https://registry.npmjs.org';

type Workflow = {
  on?: { push?: { tags?: string[] } };
  permissions?: Record<string, string>;
  jobs: Record<
    string,
    {
      uses?: string;
      needs?: string[];
      environment?: unknown;
      permissions?: Record<string, string>;
      steps?: { name?: string; if?: string; 'continue-on-error'?: boolean }[];
    }
  >;
};

const getWorkflow = async (input: {
  repoRoot: string;
  file: string;
}): Promise<Workflow> =>
  parse(
    await readFile(
      join(input.repoRoot, '.github/workflows', input.file),
      'utf8',
    ),
  );

/**
 * .what = whether a semver-shaped version (e.g., `v22.21.0`) is at least `min`
 * .why = names the comparison, so the assertion reads as the requirement it checks
 */
const isVersionAtLeast = (input: { version: string; min: string }): boolean => {
  const asParts = (v: string): number[] =>
    v.replace(/^v/, '').split('.').map(Number);
  const have = asParts(input.version);
  const need = asParts(input.min);
  const firstDiff = need.findIndex((n, i) => (have[i] ?? 0) !== n);
  if (firstDiff === -1) return true;
  return (have[firstDiff] ?? 0) > (need[firstDiff] ?? 0);
};

/**
 * .what = the github org and repo a `package.json#repository` names, in either shape npm accepts
 * .why = npm takes the shorthand (`org/repo`, `github:org/repo`) or an object with a git url; both must derive the same record
 */
const asGithubOrgRepo = (input: {
  repository: string | { url: string };
}): { org: string; repo: string } => {
  const source =
    typeof input.repository === 'string'
      ? input.repository
      : input.repository.url;
  const match = source.match(
    /^(?:github:)?(?:.*github\.com[/:])?([^/:]+)\/([^/]+?)(?:\.git)?$/,
  );
  if (!match?.[1] || !match[2])
    throw new ConstraintError(
      'package.json#repository does not name a github org and repo',
      {
        repository: input.repository,
        hint: 'set repository to "org/repo" or { "type": "git", "url": "git+https://github.com/org/repo.git" }',
      },
    );
  return { org: match[1], repo: match[2] };
};

/**
 * .what = derives the npm trusted-publisher record fields and the publish anchors from a repo root
 * .why = one derivation, run against this repo and against fixture repos for the defect branches
 */
const getTrustedPublisherFacts = async (input: { repoRoot: string }) => {
  // org + repo, from the package's repository field
  const pkg = JSON.parse(
    await readFile(join(input.repoRoot, 'package.json'), 'utf8'),
  );
  const { org, repo } = asGithubOrgRepo({ repository: pkg.repository });

  // the caller: the workflow whose job calls the reusable publish
  const files = (
    await readdir(join(input.repoRoot, '.github/workflows'))
  ).filter((f) => f.endsWith('.yml'));
  const workflows = await Promise.all(
    files.map(async (file) => ({
      file,
      workflow: await getWorkflow({ repoRoot: input.repoRoot, file }),
    })),
  );
  const callers = workflows.filter(({ workflow }) =>
    Object.values(workflow.jobs ?? {}).some(
      (job) => job.uses === PUBLISH_REUSABLE,
    ),
  );

  // the npm record names exactly one caller file, so zero or many is a defect the repo must fix
  const caller = callers[0];
  if (!caller)
    throw new ConstraintError(
      'no workflow calls the reusable publish; the npm trusted-publisher record names one caller file',
      {
        reusableWorkflow: PUBLISH_REUSABLE,
        callers: [],
        hint: "restore the caller workflow named in the npm record's Workflow filename (publish.yml unless changed on npmjs.com)",
      },
    );
  if (callers.length !== 1)
    throw new ConstraintError(
      'more than one workflow calls the reusable publish; the npm trusted-publisher record names one caller file',
      {
        reusableWorkflow: PUBLISH_REUSABLE,
        callers: callers.map(({ file }) => file),
        hint: "keep the caller whose filename matches the npm record's Workflow filename on npmjs.com; remove the others",
      },
    );
  const callerJob = Object.values(caller.workflow.jobs).find(
    (job) => job.uses === PUBLISH_REUSABLE,
  );

  // the node version the publish job sets up; npm trusted publish needs >= 22.14.0
  const nodeVersion = (
    await readFile(join(input.repoRoot, '.nvmrc'), 'utf8')
  ).trim();

  // the reusable publish job: its environment and its step order
  const reusable = await getWorkflow({
    repoRoot: input.repoRoot,
    file: '.publish-npm.yml',
  });
  const steps = reusable.jobs.publish?.steps ?? [];
  const anchorNames = [
    'verify oidc auth',
    'verify oidc compat',
    'build',
    'publish',
    'idempotify',
  ];

  return {
    record: {
      organization: org,
      repository: repo,
      workflowFilename: caller.file,
      environment: reusable.jobs.publish?.environment ?? null,
    },
    anchors: {
      callerCount: callers.length,
      callerTags: caller.workflow.on?.push?.tags ?? [],
      callerNeeds: callerJob?.needs ?? [],
      publishStepOrder: steps
        .map((step) => step.name ?? '')
        .filter((name) => anchorNames.includes(name)),
      publishContinueOnError:
        steps.find((step) => step.name === 'publish')?.['continue-on-error'] ??
        false,
      idempotifyIf:
        steps.find((step) => step.name === 'idempotify')?.if ?? null,
      idTokenWrite: {
        caller: caller.workflow.permissions?.['id-token'] ?? null,
        publishJob: reusable.jobs.publish?.permissions?.['id-token'] ?? null,
      },
    },
    runtime: { nodeVersion },
  };
};

/**
 * .what = writes a fixture repo: this repo's package.json, .nvmrc, and reusable publish, plus the named caller files
 * .why = drives the derivation down its defect branches with no change to this repo's own workflows
 */
const setFixtureRepo = async (input: {
  repoRoot: string;
  callers: string[];
  packageRepository: string | { type: string; url: string } | null;
  publishEnvironment: string | null;
}): Promise<void> => {
  const workflowsDir = join(input.repoRoot, '.github/workflows');
  await mkdir(workflowsDir, { recursive: true });

  // package.json: this repo's, with the repository field swapped when asked
  const pkg = JSON.parse(
    await readFile(join(REPO_ROOT, 'package.json'), 'utf8'),
  );
  await writeFile(
    join(input.repoRoot, 'package.json'),
    JSON.stringify({
      ...pkg,
      repository: input.packageRepository ?? pkg.repository,
    }),
  );
  await copyFile(join(REPO_ROOT, '.nvmrc'), join(input.repoRoot, '.nvmrc'));

  // the reusable publish: this repo's, with an environment on the publish job when asked
  const reusable = await getWorkflow({
    repoRoot: REPO_ROOT,
    file: '.publish-npm.yml',
  });
  await writeFile(
    join(workflowsDir, '.publish-npm.yml'),
    stringify({
      ...reusable,
      jobs: {
        ...reusable.jobs,
        publish: {
          ...reusable.jobs.publish,
          ...(input.publishEnvironment
            ? { environment: input.publishEnvironment }
            : {}),
        },
      },
    }),
  );
  await Promise.all(
    input.callers.map((file) =>
      copyFile(
        join(REPO_ROOT, '.github/workflows/publish.yml'),
        join(workflowsDir, file),
      ),
    ),
  );
};

/**
 * .what = the plain facts of a thrown error: whether it is the expected class, and its message
 * .why = a useThen result reaches its then blocks through a proxy, which a class check cannot see through
 */
const asErrorFacts = (input: {
  error: Error;
}): { isConstraintError: boolean; message: string } => ({
  isConstraintError: input.error instanceof ConstraintError,
  message: input.error.message,
});

/**
 * .what = a volatile value replaced by a placeholder that keeps its shape
 * .why = per-release registry fields (dist-tags, versions, time) change with each publish, but their presence and kind should still show in a snapshot
 */
const asMaskedValue = (input: { value: unknown }): string => {
  if (input.value === undefined) return '<absent>';
  if (input.value === null) return '<null>';
  if (Array.isArray(input.value)) return '<volatile array>';
  return `<volatile ${typeof input.value}>`;
};

const REPOSITORY_CASES: {
  description: string;
  repository: string | { url: string };
}[] = [
  { description: 'shorthand org/repo', repository: 'ehmpathy/as-command' },
  {
    description: 'shorthand with a github: prefix',
    repository: 'github:ehmpathy/as-command',
  },
  {
    description: 'shorthand with a .git suffix',
    repository: 'ehmpathy/as-command.git',
  },
  {
    description: 'object with a git+https url',
    repository: { url: 'git+https://github.com/ehmpathy/as-command.git' },
  },
  {
    description: 'object with an ssh url',
    repository: { url: 'git@github.com:ehmpathy/as-command.git' },
  },
];

const VERSION_CASES = [
  {
    description: 'equal versions',
    version: 'v22.14.0',
    min: '22.14.0',
    expect: true,
  },
  {
    description: 'higher patch',
    version: 'v22.14.1',
    min: '22.14.0',
    expect: true,
  },
  {
    description: 'higher minor, lower patch',
    version: '22.21.0',
    min: '22.14.5',
    expect: true,
  },
  {
    description: 'lower minor',
    version: 'v22.13.9',
    min: '22.14.0',
    expect: false,
  },
  {
    description: 'lower major',
    version: 'v20.19.0',
    min: '22.14.0',
    expect: false,
  },
  {
    description: 'have shorter than need, padded with zero',
    version: 'v22.14',
    min: '22.14.0',
    expect: true,
  },
  {
    description: 'have shorter than need, below',
    version: 'v22',
    min: '22.14.0',
    expect: false,
  },
];

describe('npm trusted publisher (integration)', () => {
  given('[case1] the repo at HEAD', () => {
    when('[t0] the trusted-publisher facts are derived from its files', () => {
      const facts = useThen('the derivation succeeds', async () =>
        getTrustedPublisherFacts({ repoRoot: REPO_ROOT }),
      );

      then('the record fields match the ask in the vision', () => {
        expect(facts.record).toEqual({
          organization: 'ehmpathy',
          repository: 'as-command',
          workflowFilename: 'publish.yml',
          environment: null,
        });
      });

      then('the outcome-table anchors hold', () => {
        expect(facts.anchors).toEqual({
          callerCount: 1,
          callerTags: ['v*'],
          callerNeeds: ['test'],
          publishStepOrder: [
            'verify oidc auth',
            'verify oidc compat',
            'build',
            'publish',
            'idempotify',
          ],
          publishContinueOnError: true,
          idempotifyIf: "steps.publish.outcome == 'failure'",
          idTokenWrite: { caller: 'write', publishJob: 'write' },
        });
      });

      then('the node version meets npm trusted publish (>= 22.14.0)', () => {
        expect(
          isVersionAtLeast({
            version: facts.runtime.nodeVersion,
            min: '22.14.0',
          }),
        ).toBe(true);
      });

      then('the facts match the snapshot', () => {
        expect(facts).toMatchSnapshot();
      });
    });
  });

  given('[case2] a repo where two workflows call the reusable publish', () => {
    const repoRoot = genTempDir({ slug: 'npm-trusted-publisher-two-callers' });

    when('[t0] the trusted-publisher facts are derived', () => {
      const error = useThen('the derivation refuses', async () => {
        await setFixtureRepo({
          repoRoot,
          callers: ['publish.yml', 'publish2.yml'],
          packageRepository: null,
          publishEnvironment: null,
        });
        return asErrorFacts({
          error: await getError(getTrustedPublisherFacts({ repoRoot })),
        });
      });

      then('it throws a ConstraintError, so the repo is the one to fix', () => {
        expect(error.isConstraintError).toBe(true);
      });

      then(
        'the message lists both callers and names which to keep, per the snapshot',
        () => {
          expect(error.message).toMatchSnapshot();
        },
      );
    });
  });

  given('[case3] a repo where no workflow calls the reusable publish', () => {
    const repoRoot = genTempDir({ slug: 'npm-trusted-publisher-no-caller' });

    when('[t0] the trusted-publisher facts are derived', () => {
      const error = useThen('the derivation refuses', async () => {
        await setFixtureRepo({
          repoRoot,
          callers: [],
          packageRepository: null,
          publishEnvironment: null,
        });
        return asErrorFacts({
          error: await getError(getTrustedPublisherFacts({ repoRoot })),
        });
      });

      then('it throws a ConstraintError, so the repo is the one to fix', () => {
        expect(error.isConstraintError).toBe(true);
      });

      then('the message says to restore the caller, per the snapshot', () => {
        expect(error.message).toMatchSnapshot();
      });
    });
  });

  given('[case4] the live npm registry', () => {
    when('[t0] the package document is fetched', () => {
      const result = useThen('the registry answers', async () => {
        const facts = await getTrustedPublisherFacts({ repoRoot: REPO_ROOT });
        const response = await fetch(
          `${REGISTRY}/${encodeURIComponent(PACKAGE_NAME)}`,
        );
        return { facts, status: response.status, doc: await response.json() };
      });

      then('the package is on npm, so a trust record can attach to it', () => {
        expect(result.status).toEqual(200);
        expect(result.doc.name).toEqual(PACKAGE_NAME);
      });

      then('its repository is the org and repo the record names', () => {
        expect(result.doc.repository.url).toEqual(
          `git+https://github.com/${result.facts.record.organization}/${result.facts.record.repository}.git`,
        );
      });

      then(
        'the document matches the snapshot, its per-release fields masked',
        () => {
          // dist-tags, versions, and time move with each release, so their values are masked and their shape kept
          expect({
            status: result.status,
            body: {
              name: result.doc.name,
              repository: result.doc.repository,
              'dist-tags': asMaskedValue({ value: result.doc['dist-tags'] }),
              versions: asMaskedValue({ value: result.doc.versions }),
              time: asMaskedValue({ value: result.doc.time }),
            },
          }).toMatchSnapshot();
        },
      );
    });

    when('[t1] the oidc exchange is asked with no github oidc token', () => {
      const response = useThen('the registry answers', async () => {
        const answer = await fetch(
          `${REGISTRY}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(PACKAGE_NAME)}`,
          { method: 'POST' },
        );
        return { status: answer.status, body: await answer.json() };
      });

      then(
        'it refuses with http 400, so the exchange needs the token the publish job mints',
        () => {
          expect(response.status).toEqual(400);
        },
      );

      then("the registry's own refusal words match the snapshot", () => {
        expect(response).toMatchSnapshot();
      });
    });

    when(
      '[t2] the oidc exchange is asked with a bearer token github did not mint',
      () => {
        const response = useThen('the registry answers', async () => {
          const answer = await fetch(
            `${REGISTRY}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(PACKAGE_NAME)}`,
            {
              method: 'POST',
              headers: { Authorization: 'Bearer not-a-github-oidc-token' },
            },
          );
          return { status: answer.status, body: await answer.json() };
        });

        then(
          'it refuses with http 401, not the 404 an absent trust record gives',
          () => {
            expect(response.status).toEqual(401);
          },
        );

        then("the registry's own refusal words match the snapshot", () => {
          expect(response).toMatchSnapshot();
        });
      },
    );
  });

  given('[case5] the version comparator', () => {
    when('[t0] each version is compared to its floor', () => {
      VERSION_CASES.map((thisCase) =>
        then(
          `${thisCase.description}: ${thisCase.version} vs ${thisCase.min}`,
          () => {
            expect(
              isVersionAtLeast({
                version: thisCase.version,
                min: thisCase.min,
              }),
            ).toEqual(thisCase.expect);
          },
        ),
      );
    });
  });

  given('[case7] a repo whose package.json#repository is not on github', () => {
    const repoRoot = genTempDir({ slug: 'npm-trusted-publisher-non-github' });

    when('[t0] the trusted-publisher facts are derived', () => {
      const error = useThen('the derivation refuses', async () => {
        await setFixtureRepo({
          repoRoot,
          callers: ['publish.yml'],
          packageRepository: {
            type: 'git',
            url: 'git+https://gitlab.com/ehmpathy/as-command.git',
          },
          publishEnvironment: null,
        });
        return asErrorFacts({
          error: await getError(getTrustedPublisherFacts({ repoRoot })),
        });
      });

      then('it throws a ConstraintError, so the repo is the one to fix', () => {
        expect(error.isConstraintError).toBe(true);
      });

      then('the message names the shapes npm accepts, per the snapshot', () => {
        expect(error.message).toMatchSnapshot();
      });
    });
  });

  given('[case8] the repository-field parser', () => {
    when('[t0] each shape npm accepts is parsed', () => {
      REPOSITORY_CASES.map((thisCase) =>
        then(`${thisCase.description}`, () => {
          expect(asGithubOrgRepo({ repository: thisCase.repository })).toEqual({
            org: 'ehmpathy',
            repo: 'as-command',
          });
        }),
      );
    });
  });

  given(
    '[case6] a repo whose package.json#repository is an object and whose publish job sets an environment',
    () => {
      const repoRoot = genTempDir({
        slug: 'npm-trusted-publisher-object-repo-env',
      });

      when('[t0] the trusted-publisher facts are derived', () => {
        const facts = useThen('the derivation succeeds', async () => {
          await setFixtureRepo({
            repoRoot,
            callers: ['publish.yml'],
            packageRepository: {
              type: 'git',
              url: 'git+https://github.com/ehmpathy/as-command.git',
            },
            publishEnvironment: 'npm',
          });
          return getTrustedPublisherFacts({ repoRoot });
        });

        then(
          'the record reads the org and repo from the url, and names the environment',
          () => {
            expect(facts.record).toEqual({
              organization: 'ehmpathy',
              repository: 'as-command',
              workflowFilename: 'publish.yml',
              environment: 'npm',
            });
          },
        );
      });
    },
  );
});
