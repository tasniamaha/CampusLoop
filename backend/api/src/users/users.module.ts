import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { User } from './entities/user.entity.js';
import { VerificationModule } from '../verification/verification.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([User]), VerificationModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}