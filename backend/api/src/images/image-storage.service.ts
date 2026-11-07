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

/**
 * Each kind of image lives in its own folder, so one kind's serving endpoint can never read
 * another kind's files. This matters because the resource image endpoint is public, while
 * lost-and-found photos are access-controlled.
 */
export type ImageKind = 'resources' | 'lost-found';

const ROOT_SOURCES: Record<ImageKind, { env: string; fallback: string }> = {
  resources: { env: 'UPLOAD_DIR', fallback: './uploads/resources' },
  'lost-found': { env: 'LOST_FOUND_UPLOAD_DIR', fallback: './uploads/lost-found' },
};

/** Local-disk storage. Swap this class for S3/Cloudinary later without touching the services. */
@Injectable()
export class ImageStorageService {
  private readonly roots: Record<ImageKind, string>;

  constructor() {
    const roots = {} as Record<ImageKind, string>;
    for (const kind of Object.keys(ROOT_SOURCES) as ImageKind[]) {
      const { env, fallback } = ROOT_SOURCES[kind];
      roots[kind] = resolve(process.env[env] || fallback);
    }
    // A shared folder would let the public resource endpoint serve private photos.
    const seen = new Map<string, ImageKind>();
    for (const [kind, root] of Object.entries(roots) as [ImageKind, string][]) {
      const other = seen.get(root.toLowerCase());
      if (other) {
        throw new Error(
          `Image folders for "${other}" and "${kind}" are both ${root}; ` +
            `set ${ROOT_SOURCES[other].env} and ${ROOT_SOURCES[kind].env} to different directories`,
        );
      }
      seen.set(root.toLowerCase(), kind);
    }
    this.roots = roots;
  }

  async save(kind: ImageKind, buffer: Buffer, ext: string): Promise<string> {
    const root = this.roots[kind];
    await mkdir(root, { recursive: true });
    const key = `${randomUUID()}.${ext}`;
    await writeFile(join(root, key), buffer, { flag: 'wx' });
    return key;
  }

  async remove(kind: ImageKind, key: string): Promise<void> {
    if (!STORAGE_KEY_PATTERN.test(key)) return;
    try {
      await unlink(join(this.roots[kind], key));
    } catch {
      // Already gone. Cleanup is best-effort.
    }
  }

  /** Absolute path of a file inside this kind's folder, or null for any key that isn't a storage key. */
  pathFor(kind: ImageKind, key: string): string | null {
    return STORAGE_KEY_PATTERN.test(key) ? join(this.roots[kind], key) : null;
  }
}
