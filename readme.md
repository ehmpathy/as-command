# as-command

![test](https://github.com/ehmpathy/as-command/workflows/test/badge.svg)
![publish](https://github.com/ehmpathy/as-command/workflows/publish/badge.svg)

Easily create commands within a pit of success

# install

```sh
npm install as-command
```

# use

for example

```ts
import { asCommand } from 'as-command';
import { getResourceNameFromFileName } from 'visualogic';
import { stage } from '../../../utils/environment';
import { log } from '../../../utils/logger';
import { COMMANDS_OUTPUT_DIRECTORY } from '../__tmp__/directory';

const command = asCommand(
  {
    name: getResourceNameFromFileName(__filename),
    stage: stage,
    dir: COMMANDS_OUTPUT_DIRECTORY,
    log,
  },
  async () => {
    // your logic
  }
);

// STAGE=test npx tsx src/contract/commands/yourLogic.ts
if (require.main === module) void command({});
```
