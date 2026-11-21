# F05 — practice-owned files from the boot are out of this stone's scope

## the fork

peer reviewers on 5.1 raised concerns on `.husky/*` hooks (yalc stderr discarded, unqualified 🟡 headers, soft skip when a tool is absent, an all-caps comment, positional bash args, no acceptance tests) and on vendored `.agent/.actors/**` filenames.

- **a**: hand-edit the hooks in this repo to satisfy each concern
- **b**: hold them out of this stone; route each defect to the practice that owns the file

## taken: b

- `.husky/check.{commit,yalc,nvm,secrets,lockfile,timestamps}.sh` are byte-identical to `declapract-typescript-ehmpathy@0.50.0` `practices/husky/best-practice/.husky/*` (verified via `diff -q`); `check.timestamps.lock.sh` differs only by its own `.declapract.ts` template. the boot applied them (`npx declapract apply --practice husky`), per the boot instruction
- a hand edit here drifts from the practice; the next `declapract apply` reverts it. the root cause and the fix live upstream (`rule.require.solve-at-cause`)
- `.agent/.actors/**` (AGENTS.md, CLAUDE.md) is rhachet host-local state, names fixed by the tool that reads them
- none of these files is touched by this stone's diff to `src/`; the wish is the bottleneck drop

## rework: clean

the dream carries the shape of each upstream fix; if the wisher wants them hand-fixed here instead, each is a small, local edit.

## confidence: 85%, why not higher

the files ship in this pr's diff, so a reader may see them as this pr's to fix. they arrive with the boot either way.

## where

`.husky/*`, `.agent/.actors/**`

## verdict

open — best-guess taken; a wisher veto is a clean rework

## dream

`.dream/v2026_11_14.reseed.husky-hooks-failhide-and-headers.md` (reseed → ehmpathy/declapract-typescript-ehmpathy)
