import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { configurarApp } from './configurar-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.crear(), { bufferLogs: true });
  configurarApp(app);
  await app.listen(app.get(ConfigService).getOrThrow<number>('PORT'));
}

void bootstrap();
