import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Only keys of exactly this shape are ever read or deleted, which blocks path traversal.
export const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Local-disk storage. Swap this class for S3/Cloudinary later without touching the service. */
@Injectable()
export class ImageStorageService {
  private readonly root = resolve(process.env.UPLOAD_DIR ?? './uploads/resources');

  async save(buffer: Buffer, ext: string): Promise<string> {
    await mkdir(this.root, { recursive: true });
    const key = `${randomUUID()}.${ext}`;
    await writeFile(join(this.root, key), buffer, { flag: 'wx' });
    return key;
  }

  async remove(key: string): Promise<void> {
    if (!STORAGE_KEY_PATTERN.test(key)) return;
    try {
      await unlink(join(this.root, key));
    } catch {
      // Already gone. Cleanup is best-effort.
    }
  }

  pathFor(key: string): string | null {
    return STORAGE_KEY_PATTERN.test(key) ? join(this.root, key) : null;
  }
}