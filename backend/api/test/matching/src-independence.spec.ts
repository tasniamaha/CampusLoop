// The matching scorer in src/ must be built independently of the evaluation data. Nothing under
// src/ may import test/matching (no shared colour, synonym or brand-alias lists), and production
// code under src/ may not import anything under test/ at all. Unit specs in src/ may still use
// shared test helpers such as test/helpers/image-fixtures.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = join(root, 'src');
const testDir = join(root, 'test') + sep;
const matchingDir = join(root, 'test', 'matching') + sep;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Relative specifiers of static imports, re-exports and dynamic imports. */
function importSpecifiers(source: string): string[] {
  const patterns = [
    /\b(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1])).filter((s) => s.startsWith('.'));
}

const offenders = (filter: (file: string) => boolean, forbidden: string) =>
  tsFiles(src)
    .filter(filter)
    .flatMap((file) =>
      importSpecifiers(readFileSync(file, 'utf8'))
        .filter((specifier) => resolve(dirname(file), specifier).startsWith(forbidden))
        .map((specifier) => `${relative(root, file)} imports ${specifier}`),
    );

describe('src/ independence from the matching evaluation', () => {
  it('finds the imports it is meant to catch', () => {
    expect(importSpecifiers("import { COLORS } from '../../test/matching/catalog.js';")).toEqual(['../../test/matching/catalog.js']);
    expect(importSpecifiers("export * from '../x.js';\nimport './side-effect.js';\nconst m = await import('../../test/matching/rng.js');")).toEqual([
      '../x.js', './side-effect.js', '../../test/matching/rng.js',
    ]);
    expect(importSpecifiers("import { Injectable } from '@nestjs/common';")).toEqual([]);
  });

  it('no file under src/ imports test/matching', () => {
    expect(offenders(() => true, matchingDir)).toEqual([]);
  });

  it('no production file under src/ imports anything under test/', () => {
    expect(offenders((file) => !file.endsWith('.spec.ts'), testDir)).toEqual([]);
  });
});
