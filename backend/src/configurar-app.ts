import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

/** Configuracion comun de main.ts y de los tests de integracion. */
export function configurarApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);
  app.useLogger(app.get(Logger));

  // Todo DTO usa class-validator, sin excepciones. whitelist +
  // forbidNonWhitelisted: un campo no declarado es 400, no se ignora.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.getOrThrow<string>('FRONTEND_URL'), credentials: true });
  // Detras de Traefik: req.ip = IP real del cliente (rate limit de login).
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.enableShutdownHooks();
}
