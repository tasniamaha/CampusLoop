import {
  ConflictException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './entities/user.entity.js';
import { RegisterUserDto } from './dto/register-user.dto.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async register(dto: RegisterUserDto) {
    const name = dto.name.trim();
    const email = dto.email.trim().toLowerCase();
    const campus = dto.campus.trim();
    const passwordBytes = Buffer.byteLength(dto.password, 'utf8');

    if (!name || !campus) {
      throw new BadRequestException('Name and campus cannot be blank');
    }

    if (passwordBytes > 72) {
      throw new BadRequestException(
        'Password must not exceed 72 bytes when encoded as UTF-8',
      );
    }

    const existingUser = await this.usersRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = this.usersRepository.create({
      name,
      email,
      campus,
      passwordHash,
      role: UserRole.STUDENT,
      emailVerifiedAt: null,
    });

    const savedUser = await this.usersRepository.save(user);

    // Never return the password or password hash.
    return {
      id: savedUser.id,
      name: savedUser.name,
      email: savedUser.email,
      campus: savedUser.campus,
      role: savedUser.role,
      emailVerifiedAt: savedUser.emailVerifiedAt,
      createdAt: savedUser.createdAt,
    };
  }
  async findByEmailWithPassword(email: string) {
    return this.usersRepository
        .createQueryBuilder('user')
        .addSelect('user.passwordHash')
        .where('user.email = :email', {
        email: email.trim().toLowerCase(),
        })
        .getOne();
    }
    async findById(id: string) {
        return this.usersRepository.findOne({
            where: { id },
        });
    }
}