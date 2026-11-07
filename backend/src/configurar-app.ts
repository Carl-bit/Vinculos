import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
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

  // JSON chico (02i): los archivos van por multipart (adjuntos de la ficha,
  // con su propio limite) y los documentos emitidos se redactan como texto.
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api');
  // AUD-02 (INFRA-02, CACHE-04): ninguna respuesta de la API va a un cache
  // intermedio. Las rutas publicas cacheables lo declaran con @Header
  // (imagenes de perfil), que reemplaza este valor. El cache del sitio publico
  // es el de Next (fetch con revalidate), que no lee este encabezado.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({ origin: config.getOrThrow<string>('FRONTEND_URL'), credentials: true });
  // Detras de Traefik: req.ip = IP real del cliente (rate limit de login).
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.enableShutdownHooks();
}
