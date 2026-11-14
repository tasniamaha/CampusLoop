import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLostFoundReportDto } from './create-lost-found-report.dto.js';

const base = {
  type: 'lost', title: 'Blue bottle', description: 'Steel bottle with a dent', category: 'Bottle',
  location: 'Library', itemDate: '2026-10-15',
};
const parse = async (extra: object) => {
  const dto = plainToInstance(CreateLostFoundReportDto, { ...base, ...extra });
  return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
};

describe('CreateLostFoundReportDto attributes', () => {
  it('accepts a report without the optional attributes', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toEqual([]);
    expect([dto.color, dto.brand, dto.itemDateTo]).toEqual([undefined, undefined, undefined]);
  });

  it('accepts a colour from the fixed list, ignoring case and spaces', async () => {
    const { dto, errors } = await parse({ color: ' Blue ' });
    expect(errors).toEqual([]);
    expect(dto.color).toBe('blue');
  });

  it.each(['navy', 'light blue', '', 7])('rejects colour %j', async (color) => {
    expect((await parse({ color })).errors.map((e) => e.property)).toEqual(['color']);
  });

  it('trims the brand and treats a blank one as not given', async () => {
    expect((await parse({ brand: '  Hydro   Flask ' })).dto.brand).toBe('Hydro Flask');
    const blank = await parse({ brand: '   ' });
    expect(blank.errors).toEqual([]);
    expect(blank.dto.brand).toBeUndefined();
  });

  it.each([{ brand: 'x'.repeat(61) }, { brand: 42 }, { itemDateTo: '15/10/2026' }])(
    'rejects %j',
    async (extra) => {
      expect((await parse(extra)).errors.length).toBeGreaterThan(0);
    },
  );
});
