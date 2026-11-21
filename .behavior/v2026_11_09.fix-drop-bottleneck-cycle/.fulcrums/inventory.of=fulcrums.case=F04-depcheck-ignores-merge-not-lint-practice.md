# F04 — depcheck: merge the rhachet ignores, do not apply the full lint practice

## the fork

the boot added `rhachet-*` devDeps, `yalc`, and the `.agent/` + `.claude/` trees. `test:lint:deps` then fails: those devDeps read as unused, and vendored role skills read as absent deps. also, the `test:lint:deps` command named `./depcheckrc.yml`, a file that does not exist; the real config is `./.depcheckrc.yml`.

- **a**: point the command at `.depcheckrc.yml`; merge in the lint practice's rhachet-era `ignores` and `ignorePatterns` entries
- **b**: `declapract apply --practice lint` — moves the repo from eslint + prettier to biome + dpdm, and rewrites `test:lint`

## taken: a

b reshapes the lint toolchain across every source file, far past the wish. a lands the same entries the practice's merge would add, in one file, so a later `--practice lint` apply finds them present and adds naught twice.

## rework: clean

two files: `.depcheckrc.yml`, one command in `package.json`. revert = restore both.

## confidence: 88%, why not higher

the path fix makes depcheck honor `.depcheckrc.yml` for the first time, so its extant ignores now apply too. that only widens what is ignored, and lint passes locally.

## where

`.depcheckrc.yml` · `package.json` `test:lint:deps`

## verdict

open — best-guess taken; a wisher veto is a clean rework
