# F03 — ci installs via pnpm, through the cicd practices

## the fork

the boot moved this repo to pnpm (`packageManager: pnpm@10.24.0`, `pnpm-lock.yaml`) and removed `package-lock.json`. the workflows still run `npm ci` and hash `package-lock.json` (`.github/workflows/.install.yml:27,39`; `.publish-npm.yml:36`). green ci needs one side to move:

- **a**: apply the practices that own the workflows — `cicd-common` (install, test, release, review) and `cicd-package` (publish)
- **b**: regenerate `package-lock.json` and keep npm in ci, against the boot's pnpm choice

## taken: a

the boot already chose pnpm, and the husky practice it applied checks the lockfile. the practices own the workflow files, so their output is the paved form; a hand edit to `.install.yml` alone would drift from them.

## what a brings along (read via diff against 0.50.0)

- `.install.yml`: `pnpm install --frozen-lockfile`, cache key on node version + `pnpm-lock.yaml` hash, action refs pinned by sha
- new: `.github/actions/please-release/`, `.github/actions/test-shards-setup/`, `.github/workflows/.declastruct.yml`, `report-slow-tests.sh`
- reshaped: `test.yml`, `.test.yml`, `release.yml`, `review.yml`
- `cicd-package` `publish.yml`; the repo's `.publish-npm.yml` has no peer — removed by the apply or left orphaned

## rework: clean

the change lands in `.github/` only; revert = restore those files and regenerate the npm lock.

## confidence: 80%, why not higher

the change spans more workflow surface than the wish's code fix; a reshaped `test.yml` may call a package.json command the repo lacks (e.g. for test shards). ci on the pr is the proof.

## where

`.github/`

## verdict

ruled 2026-11-09 by the director at 1.vision approval: taken as chosen

## as executed — narrowed

no paved path runs a per-practice apply (`npx declapract apply` declined; `rhx declapract.upgrade exec` applies every practice and stages all). the director dispatched the pave to rhachet-roles-ehmpathy and left F03 open to close in bounds. taken:

- `.install.yml` ← the `cicd-common` practice file, copied verbatim (`rhx cpsafe`): `pnpm install --frozen-lockfile`, keyed on `pnpm-lock.yaml`, pinned action shas. same `node-modules-cache-key` output, so every consumer is unchanged
- `.publish-npm.yml` ← drops its `npm ci` cache-miss fallback, as the `cicd-package` practice file does. its auth stays on the `npm-auth-token` secret; the practice's move to oidc needs npm-side setup by hand, so it waits for the full apply
- not taken: the reshaped `test.yml` / `.test.yml`, `release.yml`, `review.yml`, `.declastruct.yml`, the new actions — none is needed for a green install

confidence 78%: a pnpm `node_modules` restored from cache is untested on this repo's runners until the pr's ci runs. the later per-practice apply overwrites both files with the practice form, so naught here drifts from it.

## as closed — the practice workflows, copied verbatim

the pr's first ci run (#9) failed every job before a step ran: the org requires every action pinned to a full commit sha, and `.test.yml` / `review.yml` still named `@v3` / `@v5` tags. so the narrowed form could not go green.

every practice check on these files is `FileCheckType.EQUALS` with no declapract variable, so a verbatim copy writes the same bytes the apply would. copied with `rhx cpsafe`, from `declapract-typescript-ehmpathy@0.50.0`:

- `cicd-common`: `.test.yml`, `test.yml`, `release.yml`, `review.yml`, `report-slow-tests.sh`, `.github/actions/please-release/`, `.github/actions/test-shards-setup/`
- `cicd-package`: `publish.yml`, `.publish-npm.yml`
- not copied: `provision.yml` and its `.declastruct.yml` — they plan `provision/github.repo/resources.ts` on every pr, a file this repo lacks (the provision practice owns it), so they would add a red check, not remove one

proof: `diff -rq` against the practice dirs shows no file differs; no `uses:` names an unpinned tag.

🟡 caveat: the practice's `.publish-npm.yml` publishes via npm oidc (`--provenance`). the first tag after merge needs npm trusted-publisher setup for this package, if absent.

status: closed in bounds — no npx, no blanket stage. the dispatched per-practice pave stays useful for the next repo
