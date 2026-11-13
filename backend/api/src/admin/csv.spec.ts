import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv.js';

describe('csvCell', () => {
  it('neutralises cells a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","x")')).toBe(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(csvCell('+1+1')).toBe(`"'+1+1"`);
    expect(csvCell('-2+3')).toBe(`"'-2+3"`);
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('\t=1')).toBe(`"'\t=1"`);
    expect(csvCell('\r=1')).toBe(`"'\r=1"`);
  });

  it('leaves ordinary text alone, and only checks the first character', () => {
    expect(csvCell('a=b')).toBe('"a=b"');
    expect(csvCell('student')).toBe('"student"');
  });

  it('quotes every cell, doubles quotes, keeps commas and newlines inside the cell', () => {
    expect(csvCell('say "hi", then\nleave')).toBe('"say ""hi"", then\nleave"');
  });

  it('writes null/undefined as empty and dates as ISO 8601', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(new Date('2026-11-01T10:00:00Z'))).toBe('"2026-11-01T10:00:00.000Z"');
    expect(csvCell(42)).toBe('"42"');
  });
});

describe('toCsv', () => {
  it('starts with a BOM and uses CRLF line endings', () => {
    expect(toCsv(['id', 'name'], [['1', 'Ann'], ['2', '=bad']])).toBe(`\uFEFF"id","name"\r\n"1","Ann"\r\n"2","'=bad"\r\n`);
  });

  it('writes just the header for no rows', () => {
    expect(toCsv(['id'], [])).toBe('\uFEFF"id"\r\n');
  });
});
