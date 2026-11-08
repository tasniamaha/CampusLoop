import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module.js';
import { MailService } from '../../src/mail/mail.service.js';
import { User } from '../../src/users/entities/user.entity.js';
import { StudyGroupsService } from '../../src/study-groups/study-groups.service.js';
import type { CreateStudyGroupDto } from '../../src/study-groups/dto/create-study-group.dto.js';

// Shared setup for the study-group e2e specs: the real AppModule over real MySQL, with users and
// groups scoped to one random campus per spec file. Test app has NO global "api" prefix.

const PASSWORD = 'correct-horse-battery';

export type Actor = { id: string; token: string; ip: string; email: string };

export class StudyGroupsTestApp {
  app!: INestApplication;
  ds!: DataSource;
  service!: StudyGroupsService;
  readonly run = randomUUID().slice(0, 8);
  readonly userIds: string[] = [];
  private ipCounter = 0;

  constructor(
    private readonly prefix: string,
    private readonly ipBlock: string,
  ) {}

  get campus() {
    return `${this.prefix}-${this.run}`;
  }

  async start() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: async () => undefined })
      .compile();
    this.app = moduleRef.createNestApplication();
    this.app.getHttpAdapter().getInstance().set('trust proxy', true);
    this.app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await this.app.init();
    this.ds = this.app.get(DataSource);
    this.service = this.app.get(StudyGroupsService);
  }

  async stop() {
    if (this.ds?.isInitialized && this.userIds.length) {
      const marks = this.userIds.map(() => '?').join(',');
      await this.ds.query(`DELETE FROM study_groups WHERE creatorId IN (${marks})`, this.userIds); // members cascade
      await this.ds.query(`DELETE FROM refresh_tokens WHERE userId IN (${marks})`, this.userIds);
      await this.ds.query(`DELETE FROM users WHERE id IN (${marks})`, this.userIds);
    }
    await this.app?.close();
  }

  /** A verified user on this spec's campus (or `campus`). Logs in over HTTP unless `login` is false. */
  async makeUser(label: string, { campus = this.campus, login = true } = {}): Promise<Actor> {
    this.ipCounter += 1;
    const ip = `${this.ipBlock}.${this.ipCounter}`;
    const email = `${this.prefix}-${label}-${this.run}@example.com`;
    const repo = this.ds.getRepository(User);
    const user = await repo.save(
      repo.create({ name: `${this.prefix}-${label}`, email, passwordHash: await bcrypt.hash(PASSWORD, 4), campus, emailVerifiedAt: new Date() }),
    );
    this.userIds.push(user.id);
    if (!login) return { id: user.id, token: '', ip, email };
    const res = await request(this.app.getHttpServer()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: PASSWORD }).expect(201);
    return { id: user.id, token: res.body.accessToken as string, ip, email };
  }

  as(method: 'get' | 'post' | 'patch' | 'delete', url: string, who?: Actor) {
    const req = request(this.app.getHttpServer())[method](url).set('X-Forwarded-For', who?.ip ?? `${this.ipBlock}.250`);
    return who ? req.set('Authorization', `Bearer ${who.token}`) : req;
  }

  /** Creates a group through the service (the HTTP create throttle would slow setup down). */
  async createGroup(creator: Actor, overrides: Partial<CreateStudyGroupDto> = {}): Promise<{ id: string }> {
    return this.service.create(creator.id, {
      title: 'Graph algorithms revision',
      courseCode: 'CSE220',
      topic: 'Graphs',
      description: 'Weekly problem solving on graph algorithms.',
      schedule: 'Tue 3-4 PM, Library',
      participantLimit: 5,
      approvalRequired: true,
      ...overrides,
    });
  }
}
