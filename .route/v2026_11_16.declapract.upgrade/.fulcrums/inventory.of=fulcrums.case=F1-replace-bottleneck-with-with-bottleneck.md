# F1 · replace `bottleneck` with `with-bottleneck`

## the fork

dpdm found a require cycle inside prod dep `bottleneck@2.19.5`. three ways out:

- exclude `bottleneck` in `.dpdmrc.yaml`: forbidden for a prod dep (`rule.forbid.dpdm-exclude-change`)
- dispatch a fix upstream: `bottleneck` has been abandoned since 2020, so a fix will not ship
- replace the dep

## taken, and why

replace it with `with-bottleneck@0.1.2`, ehmpathy's successor. the upgrade had already added it to `dependencies`, which signals that this is the intended path. the single use maps one-to-one: `new Bottleneck({...})` → `genBottleneck({ concurrency: 1 })`; `.schedule(fn)` keeps its shape.

## rework: clean

one import, one constructor line, one dep in `package.json`. a reversal restores those three lines; no caller depends on the limiter type (it is module-private).

## confidence: 90%, and why not higher

the swap also changes behavior. the old `maxConcurrency` option is not one bottleneck reads, so appends were never serialized; now they are. that matches the code's evident intent, and integration passes 9/9. still, a human may prefer the latent-bug fix in its own commit.

## where

`src/asCommand.ts:1-9`, `package.json` dependencies.

## verdict

—
