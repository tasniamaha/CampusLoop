import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service.js';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../require-verified-email.decorator.js';

@Injectable()
export class VerifiedEmailGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_VERIFIED_EMAIL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<{ user?: { sub: string } }>();
    if (!req.user) throw new UnauthorizedException(); // decorated route that is also @Public: deny

    const user = await this.users.findById(req.user.sub);
    if (!user) throw new UnauthorizedException('User no longer exists');
    if (!user.emailVerifiedAt) throw new ForbiddenException('Verify your email address to continue.');
    return true;
  }
}