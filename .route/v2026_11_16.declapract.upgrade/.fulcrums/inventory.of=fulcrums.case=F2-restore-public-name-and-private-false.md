# F2 · restore `@ehmpathy/as-command` and `"private": false`

## the fork

the upgrade set `name: "as-command"` and `"private": true`. keep the template's values, or restore the published identity.

## taken, and why

restore. the package is published as `@ehmpathy/as-command` (readme install line), and `private: true` blocks `npm publish`. it would also make `provision/github.repo/resources.ts` flip the public repo private on the next apply to main. `false` is set explicitly because that code fails closed on an absent value.

## rework: clean

two lines in `package.json`.

## confidence: 88%, and why not higher

the template may enforce these fields as a practice, so the next `declapract.upgrade` could re-apply them. the better long-term fix may belong upstream in `declapract-typescript-ehmpathy` (derive name/private from the extant repo). not verified yet; stone 3.3 checks the practice drift.

## where

`package.json:2,5`.

## verdict

—
