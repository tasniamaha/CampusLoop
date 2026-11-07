import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { MailService } from '../src/mail/mail.service.js';
import { User } from '../src/users/entities/user.entity.js';
import { Resource } from '../src/resources/entities/resource.entity.js';
import { ResourceCategory } from '../src/resources/entities/resource-category.entity.js';
import { ImageStorageService } from '../src/images/image-storage.service.js';

// Real HTTP stack against the real image folders. The resource image endpoint is public, so it must
// only ever read the resources folder: lost-and-found photos (and anything else on disk) stay out of reach.
// Test app has NO global "api" prefix (same as the other *-http specs).

const PASSWORD = 'correct-horse-battery';
const IP = '203.0.113.61';
// Smallest input detectImageType accepts as PNG; the endpoint stores bytes as uploaded.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('resource-bytes')]);

let app: INestApplication;
let ds: DataSource;
let base: string;
let resourcesDir: string;
let lostFoundDir: string;
let token: string;
let ownerId: string;
let resourceId: string;

const server = () => app.getHttpServer();
const getImage = (key: string) => request(server()).get(`/resources/images/${key}`).set('X-Forwarded-For', IP);

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'cl-resource-images-'));
  resourcesDir = join(base, 'resources');
  lostFoundDir = join(base, 'lost-found');
  process.env.UPLOAD_DIR = resourcesDir;
  process.env.LOST_FOUND_UPLOAD_DIR = lostFoundDir;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({ send: async () => undefined })
    .compile();
  app = moduleRef.createNestApplication();
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  ds = app.get(DataSource);

  const email = `resource-images-${randomUUID().slice(0, 8)}@example.com`;
  const users = ds.getRepository(User);
  const user = await users.save(
    users.create({
      name: 'ri-owner',
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      campus: 'test',
      emailVerifiedAt: new Date(),
    }),
  );
  ownerId = user.id;
  const login = await request(server()).post('/auth/login').set('X-Forwarded-For', IP).send({ email, password: PASSWORD }).expect(201);
  token = login.body.accessToken as string;

  const category = await ds.getRepository(ResourceCategory).findOneByOrFail({ slug: 'calculators' });
  const resources = ds.getRepository(Resource);
  const resource = await resources.save(
    resources.create({ ownerId, categoryId: category.id, title: 'Image-test calculator', description: null, isListed: true }),
  );
  resourceId = resource.id;
}, 90_000);

afterAll(async () => {
  if (ds?.isInitialized) {
    await ds.query('DELETE FROM resource_images WHERE resourceId = ?', [resourceId]);
    await ds.query('DELETE FROM resources WHERE ownerId = ?', [ownerId]);
    await ds.query('DELETE FROM refresh_tokens WHERE userId = ?', [ownerId]);
    await ds.query('DELETE FROM users WHERE id = ?', [ownerId]);
  }
  await app?.close();
  await rm(base, { recursive: true, force: true });
});

describe('resource images (shared image storage)', () => {
  let key: string;
  let imageId: string;

  it('uploads into UPLOAD_DIR and serves it at the unchanged public URL', async () => {
    const upload = await request(server())
      .post(`/resources/${resourceId}/images`)
      .set('X-Forwarded-For', IP)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', PNG, { filename: 'photo.png', contentType: 'image/png' })
      .expect(201);

    const [image] = upload.body as Array<{ id: string; url: string; sortOrder: number }>;
    expect(image.url).toMatch(/^\/api\/resources\/images\/[0-9a-f-]{36}\.png$/);
    key = image.url.split('/').pop()!;
    imageId = image.id;
    expect(existsSync(join(resourcesDir, key))).toBe(true);
    expect(existsSync(join(lostFoundDir, key))).toBe(false);

    const served = await getImage(key).expect(200); // public: no Authorization header
    expect(served.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
  });

  it('does not serve a lost-and-found photo through the resource endpoint', async () => {
    const lostFoundKey = await app.get(ImageStorageService).save('lost-found', PNG, 'png');
    expect(existsSync(join(lostFoundDir, lostFoundKey))).toBe(true);

    await getImage(lostFoundKey).expect(404);
  });

  it('does not serve files outside the resources folder, however the key is spelled', async () => {
    const lostFoundKey = await app.get(ImageStorageService).save('lost-found', PNG, 'png');
    const outsideKey = `${randomUUID()}.png`;
    await writeFile(join(base, outsideKey), PNG); // a valid-looking key, but in the parent folder

    for (const attempt of [
      outsideKey,
      `..%2F${outsideKey}`,
      `..%2Flost-found%2F${lostFoundKey}`,
      `..%5Clost-found%5C${lostFoundKey}`,
      `%2E%2E%2Flost-found%2F${lostFoundKey}`,
      `${key.toUpperCase()}`,
      'not-a-key.png',
    ]) {
      const res = await getImage(attempt);
      expect(res.status, attempt).toBe(404);
    }
    // The real path-style traversal never reaches the handler at all.
    const res = await request(server()).get(`/resources/images/../../lost-found/${lostFoundKey}`).set('X-Forwarded-For', IP);
    expect(res.status).toBe(404);
  });

  it('deleting the image removes its file, as before', async () => {
    await request(server())
      .delete(`/resources/${resourceId}/images/${imageId}`)
      .set('X-Forwarded-For', IP)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(existsSync(join(resourcesDir, key))).toBe(false);
    await getImage(key).expect(404);
  });
});
