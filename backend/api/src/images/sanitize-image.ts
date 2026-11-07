import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import type { DetectedImage } from './image-type.js';

// Only these libvips decoders may ever run in this process. Everything else (GIF, TIFF, SVG, HEIF,
// PDF, raw formats ...) is refused even if a file slips past the byte-signature check.
sharp.block({ operation: ['VipsForeignLoad'] });
sharp.unblock({ operation: ['VipsForeignLoadJpeg', 'VipsForeignLoadPng', 'VipsForeignLoadWebp'] });

/**
 * Decompression-bomb guard: a small file can declare enormous dimensions. 50 MP covers full-resolution
 * photos from current phones (48 MP = 8000x6000) while capping decode memory.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

const SHARP_FORMAT: Record<DetectedImage['ext'], 'jpeg' | 'png' | 'webp'> = {
  jpg: 'jpeg',
  png: 'png',
  webp: 'webp',
};

export interface SanitizedImage {
  buffer: Buffer;
  ext: DetectedImage['ext'];
  mime: string;
  width: number;
  height: number;
}

/**
 * Re-encodes an upload so no metadata survives: EXIF (including GPS), XMP, IPTC, ICC, comments,
 * and anything appended after the image data.
 *
 * Call only after detectImageType() accepted the bytes; `detected` is that result. The photo is
 * turned upright from its EXIF orientation first, because stripping the orientation tag alone would
 * leave phone photos sideways. The output keeps the input format: JPEG and WebP at quality 85,
 * PNG losslessly. Animated PNG/WebP keep only the first frame.
 */
export async function sanitizeImage(
  input: Buffer,
  detected: DetectedImage,
  label: string,
): Promise<SanitizedImage> {
  const format = SHARP_FORMAT[detected.ext];
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
    const meta = await image.metadata();
    // The decoder libvips picked must agree with the byte signature we checked.
    if (meta.format !== format) throw new UnreadableImage();

    // sharp writes no metadata unless asked (no keepMetadata/withMetadata/withExif here).
    const pipeline = image.autoOrient();
    const encoded =
      format === 'jpeg'
        ? pipeline.jpeg({ quality: 85, mozjpeg: true })
        : format === 'webp'
          ? pipeline.webp({ quality: 85 })
          : pipeline.png({ compressionLevel: 9 });
    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return { buffer: data, ext: detected.ext, mime: detected.mime, width: info.width, height: info.height };
  } catch (err) {
    if (err instanceof Error && /pixel limit/i.test(err.message)) {
      throw new BadRequestException(`${label} has too many pixels (max ${MAX_INPUT_PIXELS / 1_000_000} megapixels)`);
    }
    // Never echo libvips messages to the client.
    throw new BadRequestException(`${label} could not be read as a JPG, PNG or WebP image`);
  }
}

class UnreadableImage extends Error {}
