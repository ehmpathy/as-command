# F06 — the boot migration rides the fix pr, as separate commits

## the fork

- **one pr**: the boot migration (rhachet devDeps, pnpm, `.nvmrc`, declapract bump, husky files, `.depcheckrc` ignores, ci install) and the #7/#8 fix ship in one pr, each as its own commit
- **two prs**: the boot migration lands first in its own pr; the fix pr rebases on it

## taken: one pr, separate commits

- the fix cannot go green on ci alone: `main` installs via `npm ci` on a `package-lock.json` the boot removed for pnpm (F03). a fix-only pr off `main` would need its own lockfile + install path, i.e. half the migration again
- the boot was a director instruction applied before the wish; this stone did not author it, and its practice-owned files route upstream (F05)
- separate commits keep each revert clean: a revert of the fix commit leaves the migration, and vice versa. the reviewer's "a revert of any one takes the fix with it" holds for one squashed commit, not for split commits
- the pr description names both parts, so a reader sees the scope
- the commit map, so each part reverts alone:
  1. the boot + pnpm migration (rhachet devDeps, `prepare`, `.depcheckrc.yml` ignores, husky, `.nvmrc`, ci install, lockfile)
  2. the fix: `asCommand`, `genRunLog`, `scheduleFileLog`, `asLogEntryLine`, `asJsonTotal`, their tests and snapshots, the `bottleneck` line in `package.json`, the readme, the acceptance test
  3. the extractions `asRunId` and `asOutFileContent` (same behavior, unit-tested)
  - `package.json` and `.depcheckrc.yml` hold hunks of 1 and 2, so the split stages by hunk

## as landed: a file-level split, three commits

- no paved path stages by hunk (`rhx permissions.get --for 'git apply --cached …'`: no paved path fits), and `pnpm-lock.yaml` is one generated file for the whole dep set, so it cannot split at all
- so the cut sits at file grain, ordered so the first commit builds and tests alone:
  1. `fix(deps)`: the fix and its dep set — `src/**`, `acceptance/**`, `readme.md`, `package.json`, `pnpm-lock.yaml`, `package-lock.json` (removed), `.depcheckrc.yml`. the rhachet devDeps and `prepare` ride here, because they share `package.json` and the lockfile
  2. `chore(boot)`: the repo kit — husky hooks, `.nvmrc`, `.gitattributes`, `.gitignore`, ci workflows, jest `.agent/` ignores, rhachet's tracked `.agent` files, `.claude`
  3. `docs(route)`: the route artifacts — `.behavior/`, `.route/`, `.dream/`
- the extractions `asRunId` and `asOutFileContent` fold into commit 1: `asCommand.ts` imports them, so a file-level cut cannot part them
- the revert property narrows: commit 2 or 3 reverts alone; commit 1 carries the rhachet devDeps with the fix

## rework: clean

a split is a branch cut at the migration commit plus a rebase of the fix commit; no code changes.

## confidence: 80%, why not higher

the repo's merge style may squash, which would fold the two commits into one. the director owns that call.

## where

the pr for this behavior; commit plan at the route's commit stone

## verdict

open — for the director at pr review
