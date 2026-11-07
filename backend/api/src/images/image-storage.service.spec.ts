import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ImageStorageService, STORAGE_KEY_PATTERN } from './image-storage.service.js';

describe('ImageStorageService', () => {
  let base: string;
  const saved = { UPLOAD_DIR: process.env.UPLOAD_DIR, LOST_FOUND_UPLOAD_DIR: process.env.LOST_FOUND_UPLOAD_DIR };

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'cl-images-'));
    process.env.UPLOAD_DIR = join(base, 'resources');
    process.env.LOST_FOUND_UPLOAD_DIR = join(base, 'lost-found');
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(base, { recursive: true, force: true });
  });

  it('stores each kind in its own folder under a server-generated key', async () => {
    const storage = new ImageStorageService();
    const key = await storage.save('lost-found', Buffer.from('lf'), 'png');

    expect(key).toMatch(STORAGE_KEY_PATTERN);
    expect(await readFile(join(base, 'lost-found', key), 'utf8')).toBe('lf');
    expect(existsSync(join(base, 'resources', key))).toBe(false);
  });

  it('resolves a key only inside the requested kind', async () => {
    const storage = new ImageStorageService();
    const key = await storage.save('lost-found', Buffer.from('private'), 'jpg');

    expect(storage.pathFor('lost-found', key)).toBe(join(base, 'lost-found', key));
    // Same key under the resources kind points into the resources folder, where no such file exists.
    expect(storage.pathFor('resources', key)).toBe(join(base, 'resources', key));
    expect(existsSync(storage.pathFor('resources', key)!)).toBe(false);
  });

  it('rejects any key that is not a bare storage key', () => {
    const storage = new ImageStorageService();
    const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
    for (const key of [
      `../lost-found/${uuid}.jpg`,
      `..\\lost-found\\${uuid}.jpg`,
      `${uuid}.jpg/../x.jpg`,
      `${uuid.toUpperCase()}.jpg`,
      `${uuid}.gif`,
      `${uuid}.jpg\0.png`,
      '',
    ]) {
      expect(storage.pathFor('resources', key), key).toBeNull();
    }
  });

  it('remove() deletes only from the given kind', async () => {
    const storage = new ImageStorageService();
    const key = await storage.save('lost-found', Buffer.from('keep'), 'webp');

    await storage.remove('resources', key);
    expect(existsSync(join(base, 'lost-found', key))).toBe(true);

    await storage.remove('lost-found', key);
    expect(existsSync(join(base, 'lost-found', key))).toBe(false);
  });

  it('defaults resources to UPLOAD_DIR and lost-found to its own folder', () => {
    delete process.env.LOST_FOUND_UPLOAD_DIR;
    const storage = new ImageStorageService();
    const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e.png';

    expect(storage.pathFor('resources', uuid)).toBe(join(base, 'resources', uuid));
    expect(storage.pathFor('lost-found', uuid)).toBe(join(process.cwd(), 'uploads', 'lost-found', uuid));
  });

  it('refuses to start when two kinds share a folder', () => {
    process.env.LOST_FOUND_UPLOAD_DIR = join(base, 'resources', '.'); // same folder, spelled differently
    expect(() => new ImageStorageService()).toThrow(/both .* set UPLOAD_DIR and LOST_FOUND_UPLOAD_DIR/s);
  });
});
