# as-command

![test](https://github.com/ehmpathy/as-command/workflows/test/badge.svg)
![publish](https://github.com/ehmpathy/as-command/workflows/publish/badge.svg)

easily create commands within a pit of success

## install

```sh
npm install @ehmpathy/as-command
```

## usage

### default outputs

create a simple command that processes data with automatic logging and output persistence:

```ts
import { asCommand } from '@ehmpathy/as-command';
import { COMMANDS_OUTPUT_DIRECTORY } from './constants';

const command = asCommand(
  {
    name: 'processData',
    stage: process.env.STAGE || 'dev',
    dir: COMMANDS_OUTPUT_DIRECTORY,
    log,
  },
  async (input: { userId: string; date: string }, context) => {
    context.log.info('starting data processing', { userId: input.userId });

    // your business logic here
    const result = {
      processed: true,
      recordCount: 42,
      timestamp: new Date().toISOString(),
    };

    context.log.info('processing complete', { result });

    return result;
  },
);

// run directly
if (require.main === module) {
  void command({
    userId: 'user-123',
    date: '2024-01-15',
  });
}
```

**output structure:**
```
__tmp__/dev/processData/
└── 20240115.143022.a1b2c3d4.../
    ├── log.json      # all logs from the run
    └── out.json      # command output
```

### custom outputs

create complex directory structures for organized output:

```ts
const command = asCommand(
  {
    name: 'analyzeData',
    stage: 'prod',
    dir: COMMANDS_OUTPUT_DIRECTORY,
    log,
  },
  async (input: { datasetId: string }, context) => {
    // write to nested directories - they're created automatically
    await context.out.write({
      name: 'reports/analytics/user-metrics.json',
      data: JSON.stringify({ activeUsers: 1500 }),
    });

    await context.out.write({
      name: 'reports/analytics/revenue-breakdown.csv',
      data: 'Category,Amount\nSubscriptions,50000\nAds,25000',
    });

    await context.out.write({
      name: 'exports/raw-data.json',
      data: JSON.stringify({ records: [] }),
    });

    return { analyzed: true };
  },
);
```

**output structure:**
```
__tmp__/prod/analyzeData/
└── 20240115.143022.i9j0k1l2.../
    ├── log.json
    ├── out.json
    ├── reports/
    │   └── analytics/
    │       ├── user-metrics.json
    │       └── revenue-breakdown.csv
    └── exports/
        └── raw-data.json
```


## concepts

### command context

each command receives a `context` object with the following methods:

#### `context.log`

logs messages at different levels. all logs are written to both console and `log.json`:

```ts
context.log.debug('debug message', { data: 'debug info' });
context.log.info('info message', { userId: 123 });
context.log.warn('warning message', { issue: 'potential problem' });
context.log.error('error message', { error: errorObject });
```

#### `context.out.write()`

writes custom files to the command's output directory:

```ts
const result = await context.out.write({
  name: 'report.csv', // supports nested paths: 'reports/analytics/data.csv'
  data: csvString, // string or Buffer
});

// result.path contains the full path to the written file
console.log(result.path);
```

### output directory structure

each command run creates a unique directory based on timestamp and input hash:

```
{dir}/__tmp__/{stage}/{command-name}/
└── {timestamp}.{input-hash}/
    ├── log.json    # all logs from the run
    ├── out.json    # command return value
    └── ...         # any files created with context.out.write()
```

**example:**
```
/var/app/__tmp__/prod/process-orders/
├── 20240115.091530.a1b2c3d4e5f6.../
│   ├── log.json
│   ├── out.json
│   └── orders-summary.csv
└── 20240115.102045.a1b2c3d4e5f6.../  # same input, different time
    ├── log.json
    ├── out.json
    └── orders-summary.csv
```

### input hashing

commands automatically hash their inputs using SHA-256. this enables:
- **deduplication detection**: same inputs produce the same hash
- **audit trails**: track when the same operation was run multiple times
- **debugging**: quickly find previous runs with identical inputs

```ts
// these two runs will have the same hash in their directory names:
await command({ userId: '123', action: 'process' });
await command({ userId: '123', action: 'process' });

// this run will have a different hash:
await command({ userId: '456', action: 'process' });
```
