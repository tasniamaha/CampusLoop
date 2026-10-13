import 'reflect-metadata';
import { beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller.js';

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
    })
      .useMocker(() => ({}))
      .compile();

    controller = module.get(UsersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});