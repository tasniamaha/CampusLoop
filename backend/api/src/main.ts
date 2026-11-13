import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Logger} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { assertUtcDatabaseClock } from './database/assert-utc-clock.js';
import { applyTrustProxy } from './common/trust-proxy.js';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // X-Forwarded-For is believed only from the proxies named in TRUST_PROXY (default: loopback,
  // the Next server on this host). Hop counts and "true" are refused; see common/trust-proxy.ts.
  applyTrustProxy(app);
  app.setGlobalPrefix('api')
  app.enableCors({ origin: process.env.WEB_URL ?? 'http://localhost:3000' });
    const isProd = process.env.NODE_ENV === 'production';

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { 'upgrade-insecure-requests': isProd ? [] : null },
      },
    }),
  );
    if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('CampusLoop API')
      .setDescription('Campus resource sharing, borrowing and handover API')
      .setVersion('1.0')
      .addBearerAuth()
      .addSecurityRequirements('bearer') // applies the lock to every endpoint
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    // Static copy for your report and repo.
    mkdirSync('docs', { recursive: true });
    writeFileSync('docs/openapi.json', JSON.stringify(document, null, 2));
  }
  await assertUtcDatabaseClock(app.get(DataSource));
  await app.listen(process.env.PORT ?? 3001);
  const o = app.get(DataSource).options as { host?: string; port?: number; database?: string };
  new Logger('Database').log(`Connected to "${o.database}" on ${o.host}:${o.port}`);
}
await bootstrap();
