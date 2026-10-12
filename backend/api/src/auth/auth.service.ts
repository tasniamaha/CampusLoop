
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(
      dto.email,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = {
      sub: user.id,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        campus: user.campus,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt,
      },
    };
  }
    async getProfile(userId: string) {
        const user = await this.usersService.findById(userId);

        if (!user) {
            throw new UnauthorizedException('User no longer exists');
        }

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            campus: user.campus,
            role: user.role,
            emailVerifiedAt: user.emailVerifiedAt,
            createdAt: user.createdAt,
        };
    }
}
