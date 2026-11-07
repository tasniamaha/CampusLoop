import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Migrations resolved next to THIS file, so the path works from src/ (tests, ts-node) and from
 * dist/ (node dist/main), regardless of the working directory or whether src/ was deployed.
 *
 * Exactly one extension: dist/ also contains .d.ts files, which a `*.{ts,js}` glob would load
 * as migrations. Forward slashes: the glob library does not accept Windows backslashes.
 */
const here = dirname(fileURLToPath(import.meta.url));
const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

export const MIGRATIONS_GLOB = join(here, 'migrations', `*.${extension}`).replace(/\\/g, '/');
