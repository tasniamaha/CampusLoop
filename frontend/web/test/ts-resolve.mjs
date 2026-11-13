// Lets Node load the app's TypeScript modules directly (Node 24 strips types natively). Only for
// imports made by the app's own files, never inside node_modules:
//  - relative imports without an extension ("./lib/session") resolve to the .ts file;
//  - next/* subpaths resolve to their .js entry ("next/server" -> "next/server.js"), because
//    next has no package exports map for ESM to use.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NEXT_SUBPATH = /^next\/[\w/-]+$/;
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL;
    if (parent?.startsWith('file:') && !parent.includes('/node_modules/')) {
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && !HAS_EXTENSION.test(specifier)) {
        const candidate = new URL(`${specifier}.ts`, parent);
        if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
      }
      if (NEXT_SUBPATH.test(specifier)) return next(`${specifier}.js`, context);
    }
    return next(specifier, context);
  },
});
