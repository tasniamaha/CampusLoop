import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { sanitizeImage } from './sanitize-image.js';
import { detectImageType } from './image-type.js';
import {
  containsAnyMarker,
  hasGpsPointer,
  imageWithMetadata,
  pixelBomb,
  plainImage,
} from '../../test/helpers/image-fixtures.js';

const detect = (buf: Buffer) => {
  const d = detectImageType(buf);
  if (!d) throw new Error('fixture not recognised');
  return d;
};

describe('sanitizeImage', () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    it(`${format}: strips EXIF, GPS and XMP, applies orientation, keeps the format`, async () => {
      const input = await imageWithMetadata(format);
      const before = await sharp(input).metadata();
      // Guard against a fixture that silently lost its metadata: the test would pass for nothing.
      expect(before.orientation).toBe(6);
      expect(hasGpsPointer(before.exif)).toBe(true);
      expect(before.xmp).toBeDefined();
      expect(containsAnyMarker(input)).toBe(true);

      const out = await sanitizeImage(input, detect(input), 'File #1');
      const after = await sharp(out.buffer).metadata();

      expect(after.format).toBe(format);
      expect(detectImageType(out.buffer)?.ext).toBe(detect(input).ext);
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.iptc).toBeUndefined();
      expect(after.icc).toBeUndefined();
      expect(after.orientation).toBeUndefined();
      expect(containsAnyMarker(out.buffer)).toBe(false);
      expect(out.buffer.includes('Exif\0\0')).toBe(false);
      // 40x20 stored with orientation 6 displays as 20x40; the pixels are now physically upright.
      expect([after.width, after.height]).toEqual([20, 40]);
      expect([out.width, out.height]).toEqual([20, 40]);
    });
  }

  it('drops data appended after the image (polyglot files)', async () => {
    const input = Buffer.concat([await plainImage('jpeg'), Buffer.from('<?php system($_GET["c"]); ?>')]);
    const out = await sanitizeImage(input, detect(input), 'File #1');
    expect(out.buffer.includes('<?php')).toBe(false);
  });

  it('rejects images over the pixel limit without decoding them', async () => {
    const input = await pixelBomb();
    expect(input.length).toBeLessThan(5 * 1024 * 1024); // passes the byte-size limit on purpose
    await expect(sanitizeImage(input, detect(input), 'File #2')).rejects.toThrow(
      new BadRequestException('File #2 has too many pixels (max 50 megapixels)'),
    );
  });

  it('rejects a truncated file without leaking decoder messages', async () => {
    const input = (await plainImage('jpeg', 64, 64)).subarray(0, 200);
    const err = await sanitizeImage(input, detect(input), 'File #3').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe('File #3 could not be read as a JPG, PNG or WebP image');
  });

  it('refuses formats other than JPEG, PNG and WebP even if told they are allowed', async () => {
    const gif = await plainImage('gif');
    // Simulates a type check that was fooled: sharp itself must still refuse to decode the GIF.
    await expect(sanitizeImage(gif, { ext: 'png', mime: 'image/png' }, 'File #1')).rejects.toThrow(BadRequestException);
  });

  it('rejects bytes whose real format disagrees with the detected type', async () => {
    const jpeg = await plainImage('jpeg');
    await expect(sanitizeImage(jpeg, { ext: 'png', mime: 'image/png' }, 'File #1')).rejects.toThrow(
      'File #1 could not be read as a JPG, PNG or WebP image',
    );
  });
});
