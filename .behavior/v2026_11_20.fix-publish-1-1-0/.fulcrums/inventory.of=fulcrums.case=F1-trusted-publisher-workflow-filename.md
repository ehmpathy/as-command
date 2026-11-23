# F1 — trusted publisher workflow filename

- **the fork**: npm's trusted publisher form asks for one workflow filename. the publish runs in `.publish-npm.yml`, a reusable workflow called by `publish.yml`
- **taken**: `publish.yml`, the caller
- **rework**: clean — edit one field on npmjs.com, rerun the job. no repo change
- **confidence**: 97%. docs.npmjs.com/trusted-publishers: *"validation checks the calling workflow's name instead of the workflow that actually contains the publish command"*. the residual 3% is first-registration behavior not yet seen live
- **where**: `1.vision.yield.md` → the ask, step 1
- **verdict**: settled by docs; the rerun's `verify oidc auth` step confirms live (2xx)
