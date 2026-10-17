import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import {ConfigModule,ConfigService} from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { APP_GUARD } from '@nestjs/core'
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { ResourcesModule } from './resources/resources.module.js';
import { BorrowRequestsModule } from './borrow-requests/borrow-requests.module.js';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  defaultTracker,
  isLoginHandler,
  loginAccountTracker,
  loginIpTracker,
} from './common/login-throttle.js';
import { ExecutionContext} from '@nestjs/common';
import { VerifiedEmailGuard } from './auth/guards/verified-email.guard.js';
import { AuditModule } from './audit/audit.module.js';
import { LostFoundModule } from './lost-found/lost-found.module.js';
import { StudyGroupsModule } from './study-groups/study-groups.module.js';
const optIn = (name: string) => (ctx: ExecutionContext) =>
  !Reflect.getMetadata(`THROTTLER:LIMIT${name}`, ctx.getHandler());
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal:true
    }),
    ThrottlerModule.forRoot({
      getTracker: defaultTracker,
      throttlers: [
        // Everything: 120 req/min per verified user id, or per IP when anonymous.
        { name: 'default', ttl: 60_000, limit: 120 },
        // Login only: 5 attempts/min per (IP + email) ...
        {
          name: 'login-account',
          ttl: 60_000,
          limit: 5,
          getTracker: loginAccountTracker,
          skipIf: (ctx) => !isLoginHandler(ctx),
        },
        // ... and 20 attempts/min per IP across all emails.
        {
          name: 'login-ip',
          ttl: 60_000,
          limit: 20,
          getTracker: loginIpTracker,
          skipIf: (ctx) => !isLoginHandler(ctx),
        },
        { name: 'mail-ip', ttl: 3_600_000, limit: 20, getTracker: loginIpTracker, skipIf: optIn('mail-ip') },
        { name: 'mail-user', ttl: 3_600_000, limit: 3, skipIf: optIn('mail-user') },
      ],
    }),    
    TypeOrmModule.forRootAsync({
      imports:[ConfigModule],
      inject:[ConfigService],
      useFactory:(config:ConfigService)=>({
        type:'mariadb',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 3306),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    UsersModule,
    AuthModule,ResourcesModule, BorrowRequestsModule,AuditModule,LostFoundModule,StudyGroupsModule
  ],
  controllers: [AppController],
    providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: VerifiedEmailGuard },
  ],
})
export class AppModule {}
