import { Body, Controller, Post } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { RegisterUserDto } from './dto/register-user.dto.js';
import { Public } from '../auth/public.decorator.js';
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

 @Public()
  @Post('register')
  register(@Body() dto: RegisterUserDto) {
    return this.usersService.register(dto);
  }
}