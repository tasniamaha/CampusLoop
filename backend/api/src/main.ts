import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { mkdirSync, writeFileSync } from 'node:fs';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
    // Only trust X-Forwarded-For when the API sits behind a proxy YOU control that overwrites it.
  // TRUST_PROXY examples: "1" (one hop), "loopback", "10.0.0.0/8". Unset = ignore the header.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }
  app.setGlobalPrefix('api')
  app.enableCors({
    origin: 'http://localhost:3000',
  });
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
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
