import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Pipe global de validacion: todo DTO usa class-validator, sin excepciones.
  // whitelist + forbidNonWhitelisted = cualquier campo no declarado en el DTO
  // es un 400, no un campo silenciosamente ignorado.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL', 'http://localhost:3000'),
    credentials: true,
  });

  // El filtro global de excepciones (traduccion del constraint EXCLUDE a 409)
  // se registra en AppModule via APP_FILTER, lo genera el prompt 02_apis.md.

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(`Backend escuchando en :${port}`);
}

void bootstrap();
