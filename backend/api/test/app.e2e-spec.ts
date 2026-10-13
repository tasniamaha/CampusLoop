import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('GET / without a token is rejected by the global JWT guard', async () => {
    await request(app.getHttpServer()).get('/').expect(401);
  });

  it('GET /resources without a token is rejected', async () => {
    await request(app.getHttpServer()).get('/resources').expect(401);
  });

  it('GET /borrow-requests without a token is rejected', async () => {
    await request(app.getHttpServer()).get('/borrow-requests?role=incoming').expect(401);
  });
    it('rate-limits repeated login attempts for the same email', async () => {
    const body = { email: 'nobody@example.com', password: 'not-a-real-password-1' };
    const statuses: number[] = [];

    for (let i = 0; i < 7; i++) {
      const res = await request(app.getHttpServer()).post('/auth/login').send(body);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});