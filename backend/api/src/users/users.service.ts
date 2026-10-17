import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole } from './entities/user.entity.js';
import { RegisterUserDto } from './dto/register-user.dto.js';
import { isDuplicateEntry } from '../common/db-errors.js';
import { EmailVerificationService } from '../verification/email-verification.service.js';
import { canonicalEmail } from '../common/email.js';
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly verification: EmailVerificationService,
  ) {}

  async register(dto: RegisterUserDto) {
    const name = dto.name.trim();
    const email = dto.email.trim().toLowerCase();
    const campus = dto.campus.trim();
    const emailCanonical = canonicalEmail(email);

    if (!name || !campus) {
      throw new BadRequestException('Name and campus cannot be blank');
    }
    if (Buffer.byteLength(dto.password, 'utf8') > 72) {
      throw new BadRequestException('Password must not exceed 72 bytes when encoded as UTF-8');
    }

    // Hash first so "new address" and "already registered" take similar time.
    const passwordHash = await bcrypt.hash(dto.password, 12);

    let target: { id: string; email: string; name: string } | null = null;
    try {
      const saved = await this.usersRepository.save(
        this.usersRepository.create({
          name,
          email,
          campus,
          passwordHash,
          role: UserRole.STUDENT,
          emailVerifiedAt: null,
           emailCanonical,
        }),
      );
      target = { id: saved.id, email: saved.email, name: saved.name };
    } catch (err) {
      if (!isDuplicateEntry(err)) throw err;
      const existing = await this.usersRepository.findOne({ where: { emailCanonical } });
      if (existing && !existing.emailVerifiedAt) target = existing;
    }

    if (target) {
      void this.verification
        .sendFor(target)
        .catch((err: Error) => this.logger.error(`Could not queue verification mail: ${err.message}`));
    }

    // Identical for new, unverified-existing and verified-existing addresses.
    return { message: 'If this email can be registered, a verification link is on its way. Check your inbox.' };
  }

  async findByEmailWithPassword(email: string) {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.emailCanonical = :c', { c: canonicalEmail(email) })
      .getOne();
  }

  async findById(id: string) {
    return this.usersRepository.findOne({ where: { id } });
  }
}