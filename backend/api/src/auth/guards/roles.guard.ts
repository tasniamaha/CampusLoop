import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service.js';
import { UserRole } from '../../users/entities/user.entity.js';
import { ROLES_KEY } from '../roles.decorator.js';

interface AuthenticatedRequest {
  user?: {
    sub: string;
    role: string;
  };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Routes without @Roles() keep their existing authentication and
    // ownership rules; this guard does not invent role restrictions.
    if (!requiredRoles?.length) return true;

    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();
    const subject = request.user?.sub;

    if (!subject) {
      throw new UnauthorizedException('Authentication required');
    }

    // Read the current role from the database, not the potentially stale
    // role claim embedded in an access token.
    const user = await this.users.findById(subject);

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    request.user = {
      sub: user.id,
      role: user.role,
    };

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}