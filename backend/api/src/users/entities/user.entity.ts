import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
} from 'typeorm';
import { canonicalEmail } from '../../common/email.js';

export enum UserRole {
  STUDENT = 'student',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
}

@Entity('users')
export class User {
  // UUID, not auto-increment: this id becomes a foreign key in resources,
  // loans, etc., so changing its type later is the one expensive change.
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  // Always store lowercased (normalise in the service). The utf8mb4_unicode_ci
  // collation also makes this UNIQUE index case-insensitive as a backstop.
  @Column({ type: 'varchar', length: 254, unique: true })
  email!: string;

  // Dedup key: strips Gmail dots and +tags. `email` keeps what the user typed.
  @Column({ type: 'varchar', length: 254, unique: true })
  emailCanonical!: string;

  // select:false hides it from normal reads. It does NOT hide it on the object
  // you pass to save(); never return that object from a controller.
  @Column({ type: 'varchar', length: 255, select: false })
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.STUDENT })
  role!: UserRole;

  // Resources and requests are scoped per campus.
  @Column({ type: 'varchar', length: 100 })
  campus!: string;

  // A timestamp records WHEN; a boolean cannot. NULL = not verified.
  @Column({ type: 'datetime', nullable: true })
  emailVerifiedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  setCanonicalEmail() {
    this.emailCanonical ??= canonicalEmail(this.email);
  }
}