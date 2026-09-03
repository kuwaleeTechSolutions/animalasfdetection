// Runs all test suites in sequence and exits non-zero if any fail.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const suites = ['contactTracing.test.mts', 'riskScoring.test.mts'];
let anyFailed = false;

for (const suite of suites) {
  console.log(`\n############################################\n# Running ${suite}\n############################################`);
  const result = spawnSync(process.execPath, [join(__dirname, suite)], { stdio: 'inherit' });
  if (result.status !== 0) anyFailed = true;
}

if (anyFailed) {
  console.error('\nOne or more test suites FAILED.');
  process.exit(1);
} else {
  console.log('\nAll test suites PASSED.');
}
