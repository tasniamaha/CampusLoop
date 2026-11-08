import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../public.decorator.js';
import { UsersService } from '../../users/users.service.js';

interface JwtPayload {
  sub: string;
  role: string;
  purpose?: string;
}

/**
 * What later guards and controllers see as `req.user`. `role` is the CURRENT role from the
 * database, not the claim in the token; `roleFromDb` tells RolesGuard it needn't read it again.
 */
export interface AuthenticatedUser {
  sub: string;
  role: string;
  roleFromDb?: true;
}

interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const authorization = request.headers.authorization;
    const [scheme, token] = authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing or invalid access token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // Only real session tokens may authenticate. QR tokens share the signing key and must never act as logins.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.purpose !== undefined) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // One primary-key read per request: a deleted or deactivated account loses access immediately,
    // not when its access token expires.
    const user = await this.users.findAuthState(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (user.deactivatedAt) {
      throw new UnauthorizedException('This account has been deactivated.');
    }

    request.user = { sub: user.id, role: user.role, roleFromDb: true };
    return true;
  }
}
