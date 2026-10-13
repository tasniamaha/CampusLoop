import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
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
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './common/app-throttler.guard.js';
export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ConfigModule.forRoot({
      isGlobal:true
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]), // 120 requests/minute per tracker
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
    ObserveModule.forRoot({
      appKey: 'YOUR_APP_KEY',
      appSecret: 'YOUR_APP_SECRET',
      serviceId: 'api',
    }),
    UsersModule,
    AuthModule,ResourcesModule, BorrowRequestsModule
  ],
  controllers: [AppController],
  providers: [AppService,
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    }
  ],
})
export class AppModule {}
