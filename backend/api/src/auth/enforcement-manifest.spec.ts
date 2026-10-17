import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { ResourcesController } from '../resources/resources.controller.js';
import { BorrowRequestsController } from '../borrow-requests/borrow-requests.controller.js';
import { LostFoundController } from '../lost-found/lost-found.controller.js';
import { REQUIRE_VERIFIED_EMAIL_KEY } from './require-verified-email.decorator.js';

// Write routes that are intentionally open to unverified users.
const OPEN_WRITES = new Set([
  'ResourcesController.favorite',
  'ResourcesController.unfavorite',
  'BorrowRequestsController.cancel',
]);

function writeHandlers(controller: { name: string; prototype: object }) {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((n) => n !== 'constructor')
    .map((n) => ({ name: n, fn: (controller.prototype as Record<string, unknown>)[n] as object }))
    .filter(({ fn }) => typeof fn === 'function')
    .filter(({ fn }) => {
      const method = Reflect.getMetadata('method', fn); // set by @Get/@Post/...
      return method !== undefined && method !== RequestMethod.GET;
    })
    .map(({ name, fn }) => ({ id: `${controller.name}.${name}`, fn }));
}

describe('verified-email enforcement manifest', () => {
  for (const controller of [ResourcesController, BorrowRequestsController, LostFoundController]) {
    for (const { id, fn } of writeHandlers(controller)) {
      it(`${id} is gated or explicitly allowlisted`, () => {
        const gated = Reflect.getMetadata(REQUIRE_VERIFIED_EMAIL_KEY, fn) === true;
        expect(gated || OPEN_WRITES.has(id)).toBe(true);
      });
    }
  }
});