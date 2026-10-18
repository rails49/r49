import { isDeepStrictEqual } from 'node:util';

/**
 * The few vitest-style matchers the TypeScript tests use, so they run on
 * node:test (see register.mjs for why not vitest).
 *
 * `toEqual` is recursive equality that ignores properties set to undefined;
 * `toMatchObject` is the same but lets the actual value carry more keys.
 */

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

const show = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function equals(actual: unknown, expected: unknown, partial: boolean): boolean {
  if (Object.is(actual, expected)) return true;
  if (!isObject(actual) || !isObject(expected)) return false;
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, i) => equals(actual[i], item, partial))
    );
  }
  if (ArrayBuffer.isView(expected)) return isDeepStrictEqual(actual, expected);
  const defined = (o: Record<string, unknown>) => Object.keys(o).filter(k => o[k] !== undefined);
  const keys = defined(expected);
  if (!partial && defined(actual).length !== keys.length) return false;
  return keys.every(k => equals(actual[k], expected[k], partial));
}

type Check = (actual: unknown) => [ok: boolean, message: string];

export interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toMatchObject(expected: object): void;
  toContain(item: unknown): void;
  toMatch(pattern: RegExp | string): void;
  toBeNull(): void;
  toBeUndefined(): void;
  toHaveLength(length: number): void;
  toHaveProperty(key: string): void;
  toBeCloseTo(expected: number, digits?: number): void;
  toBeLessThan(bound: number): void;
  toBeGreaterThan(bound: number): void;
}

function matchers(actual: unknown, negated: boolean): Matchers {
  const run = (check: Check) => {
    const [ok, message] = check(actual);
    if (ok === negated) throw new AssertionError(`expected ${show(actual)} ${negated ? 'not ' : ''}${message}`);
  };
  return {
    toBe: e => run(a => [Object.is(a, e), `to be ${show(e)}`]),
    toEqual: e => run(a => [equals(a, e, false), `to equal ${show(e)}`]),
    toMatchObject: e => run(a => [equals(a, e, true), `to match ${show(e)}`]),
    toContain: item =>
      run(a => [
        (typeof a === 'string' || Array.isArray(a)) && a.includes(item as never),
        `to contain ${show(item)}`,
      ]),
    toMatch: p => run(a => [typeof a === 'string' && new RegExp(p).test(a), `to match ${p}`]),
    toBeNull: () => run(a => [a === null, 'to be null']),
    toBeUndefined: () => run(a => [a === undefined, 'to be undefined']),
    toHaveLength: n =>
      run(a => [
        (typeof a === 'string' || isObject(a)) && (a as { length?: unknown }).length === n,
        `to have length ${n}`,
      ]),
    toHaveProperty: k => run(a => [isObject(a) && k in a, `to have property ${k}`]),
    toBeCloseTo: (e, digits = 2) =>
      run(a => [
        typeof a === 'number' && Math.abs(a - e) < 10 ** -digits / 2,
        `to be close to ${e} (${digits} digits)`,
      ]),
    toBeLessThan: b => run(a => [typeof a === 'number' && a < b, `to be less than ${b}`]),
    toBeGreaterThan: b => run(a => [typeof a === 'number' && a > b, `to be greater than ${b}`]),
  };
}

export function expect(actual: unknown) {
  return {
    ...matchers(actual, false),
    not: matchers(actual, true),
    /** The matchers, applied to what a promise rejects with. */
    rejects: {
      async toMatchObject(expected: object): Promise<void> {
        let rejected = false;
        let reason: unknown;
        try {
          await actual;
        } catch (err) {
          rejected = true;
          reason = err;
        }
        if (!rejected) throw new AssertionError('expected the promise to reject');
        matchers(reason, false).toMatchObject(expected);
      },
    },
  };
}
