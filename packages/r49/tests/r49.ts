/**
 * The package the conformance runner judges: this source, or the installed
 * package whose `dist/index.js` `R49_MODULE` names
 * (`scripts/check-packages.sh`).
 */
const r49: typeof import('../src/index.ts') = await import(process.env.R49_MODULE ?? '../src/index.ts');

export const { FORMAT_RULES, R49Archive, R49Error, getDPT, getDPTResidual } = r49;
