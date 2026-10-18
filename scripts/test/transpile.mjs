// The loader hook register.mjs installs: every .ts module is transpiled on
// load, one file at a time, with the typescript of the package under test.
// Types are not checked here; `tsc --noEmit` does that.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ts = createRequire(join(process.cwd(), 'package.json'))('typescript');

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('.ts')) return nextLoad(url, context);
  const fileName = fileURLToPath(url);
  const { outputText } = ts.transpileModule(await readFile(fileName, 'utf8'), {
    fileName,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return { format: 'module', source: outputText, shortCircuit: true };
}
