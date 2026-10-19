import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListNotificationsQueryDto } from './list-notifications-query.dto.js';

const parse = async (plain: object) => {
  const dto = plainToInstance(ListNotificationsQueryDto, plain);
  return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
};

describe('ListNotificationsQueryDto', () => {
  it('applies defaults', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toEqual([]);
    expect([dto.page, dto.limit, dto.unreadOnly]).toEqual([1, 20, undefined]);
  });

  it.each([['true', true], ['false', false]])('unreadOnly=%s -> %s', async (raw, expected) => {
    expect((await parse({ unreadOnly: raw })).dto.unreadOnly).toBe(expected);
  });

  it.each([{ page: '0' }, { limit: '51' }, { limit: 'abc' }, { unreadOnly: 'maybe' }, { admin: '1' }])('rejects %j', async (q) => {
    expect((await parse(q)).errors.length).toBeGreaterThan(0);
  });
});