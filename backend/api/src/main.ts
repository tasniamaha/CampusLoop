import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api')
  app.enableCors({
    origin: 'http://localhost:3000',
  });
  app.use(
    helmet({
      // Required: the frontend (another origin) loads listing photos from this API via <img>.
      // Helmet's default "same-origin" would make browsers block them.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
