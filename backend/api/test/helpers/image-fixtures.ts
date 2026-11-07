import sharp from 'sharp';

/** Strings planted in fixture metadata. None of them may survive sanitising. */
export const SECRET_MARKERS = ['CL-SECRET-DESC', 'CL-SECRET-MAKE', 'CL-SECRET-XMP'] as const;

const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>CL-SECRET-XMP</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>`;

/**
 * A real image carrying EXIF (camera make, description, GPS position), XMP and an EXIF orientation
 * of 6 (rotate 90° clockwise to display). Stored pixels are width x height; displayed upright they
 * are height x width.
 */
export async function imageWithMetadata(
  format: 'jpeg' | 'png' | 'webp',
  width = 40,
  height = 20,
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#2a7' } })
    .withExif({
      IFD0: { ImageDescription: 'CL-SECRET-DESC', Make: 'CL-SECRET-MAKE' },
      // IFD3 is the GPS directory in libvips naming. Dhaka, roughly.
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 48/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '90/1 24/1 0/1' },
    })
    .withMetadata({ orientation: 6 })
    .withXmp(XMP)
    .toFormat(format)
    .toBuffer();
}

/** A plain image with no metadata. */
export async function plainImage(format: 'jpeg' | 'png' | 'webp' | 'gif', width = 8, height = 8): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#357' } }).toFormat(format).toBuffer();
}

/** Small on disk, 100 megapixels when decoded. */
export async function pixelBomb(): Promise<Buffer> {
  return sharp({ create: { width: 10_000, height: 10_000, channels: 3, background: '#000' } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** True if the EXIF block references a GPS directory (tag 0x8825, either byte order). */
export function hasGpsPointer(exif: Buffer | undefined): boolean {
  if (!exif) return false;
  return exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88]));
}

export function containsAnyMarker(buf: Buffer): boolean {
  return SECRET_MARKERS.some((m) => buf.includes(m));
}
