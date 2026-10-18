// Runs the TypeScript tests on Node's own test runner, with no bundler:
//
//   node --import ../../scripts/test/register.mjs --test 'tests/**/*.test.ts'
//
// vitest needs vite, and vite needs rollup's and esbuild's native binaries
// for the platform it runs on; the offline gate cannot fetch them. This needs
// only the typescript package, which is plain JavaScript.
import { register } from 'node:module';

register('./transpile.mjs', import.meta.url);
