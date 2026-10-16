import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service.js';
import { RegisterUserDto } from './dto/register-user.dto.js';
import { Public } from '../auth/public.decorator.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Throttle({ 'mail-ip': { limit: 20, ttl: 3_600_000 } }) // generous: a campus shares NAT addresses
  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.usersService.register(dto);
  }
}