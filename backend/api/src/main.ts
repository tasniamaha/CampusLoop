import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  app.setGlobalPrefix('api')
  app.enableCors({
    origin: 'http://localhost:3000',
  });
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
