import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AuthService],
    })
      // Any constructor dependency (UsersService, JwtService, ...) is replaced by an empty mock.
      .useMocker(() => ({}))
      .compile();

    service = module.get(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});