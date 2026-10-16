import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

const handler = (name: keyof AuthController) => AuthController.prototype[name] as unknown as object;
const emailLinkRoutes = ['forgotPassword', 'resetPassword', 'verifyEmail'] as const;

describe('email-link routes', () => {
  it.each(emailLinkRoutes)('%s is public (the user is not logged in)', (name) => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler(name))).toBe(true);
  });

  it.each(emailLinkRoutes)('%s opts into the mail-ip throttler', (name) => {
    expect(Reflect.getMetadata('THROTTLER:LIMITmail-ip', handler(name))).toBeDefined();
  });

  it.each(emailLinkRoutes)('%s is POST, so mail scanners that prefetch links cannot consume tokens', (name) => {
    expect(Reflect.getMetadata('method', handler(name))).toBe(RequestMethod.POST);
  });

  it('resendVerification is not public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler('resendVerification'))).toBeUndefined();
  });
});
