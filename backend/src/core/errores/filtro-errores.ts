import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';

import { ErrorCifrado } from '../../common/crypto/cifrado';
import { errorBd, HTTP_POR_SQLSTATE, MENSAJE_POR_RESTRICCION, MENSAJE_POR_SQLSTATE } from './sqlstate';

export interface CuerpoError {
  statusCode: number;
  error: string;
  mensaje: string | string[];
  sqlstate?: string;
  restriccion?: string;
  requestId?: string;
}

/**
 * Filtro global (requisitos_02_apis.md 2). Envuelve tambien los errores al
 * COMMIT: el RlsInterceptor devuelve la promesa del $transaction completo.
 *
 * - Errores de Postgres: SQLSTATE -> HTTP; mensaje propio (por restriccion
 *   conocida o por SQLSTATE). Nunca el texto de Postgres ni de Prisma (puede
 *   traer valores del create).
 * - ErrorCifrado: 500 generico, se loguea sin el dato.
 * - Lo demas sin HttpException: 500 generico.
 */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  private readonly logger = new Logger('Errores');

  constructor(private readonly cls: ClsService) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const respuesta = host.switchToHttp().getResponse<Response>();
    const cuerpo = this.traducir(error);
    cuerpo.requestId = this.cls.isActive() ? this.cls.getId() : undefined;
    if (error instanceof ThrottlerException) {
      respuesta.setHeader('Retry-After', '60');
    }
    respuesta.status(cuerpo.statusCode).json(cuerpo);
  }

  traducir(error: unknown): CuerpoError {
    const bd = errorBd(error);
    if (bd) {
      const statusCode = HTTP_POR_SQLSTATE[bd.sqlstate] ?? (bd.sqlstate.startsWith('22') ? 422 : 500);
      const mensaje = (bd.restriccion && MENSAJE_POR_RESTRICCION[bd.restriccion]) ?? MENSAJE_POR_SQLSTATE[bd.sqlstate] ?? 'Error interno';
      const nivel = statusCode >= 500 ? 'error' : 'warn';
      this.logger[nivel](`BD sqlstate=${bd.sqlstate} restriccion=${bd.restriccion ?? '-'} -> ${statusCode}`);
      return {
        statusCode,
        error: HttpStatus[statusCode] ?? 'ERROR',
        mensaje: statusCode >= 500 ? 'Error interno' : mensaje,
        sqlstate: statusCode >= 500 ? undefined : bd.sqlstate,
        restriccion: statusCode >= 500 ? undefined : bd.restriccion,
      };
    }
    if (error instanceof HttpException) {
      const r = error.getResponse();
      // Campos extra que arma el servicio (p. ej. alternativas de agenda) pasan tal cual.
      const { message, statusCode: _s, error: _e, ...extra } = (typeof r === 'string' ? {} : r) as Record<string, unknown>;
      return {
        ...extra,
        statusCode: error.getStatus(),
        error: HttpStatus[error.getStatus()] ?? 'ERROR',
        mensaje: typeof r === 'string' ? r : ((message as string | string[] | undefined) ?? error.message),
      };
    }
    // body-parser (antes de la ruta): JSON sobre el limite (413) o mal formado (400).
    const cuerpo = (error ?? {}) as { status?: unknown; type?: unknown };
    if (typeof cuerpo.type === 'string' && typeof cuerpo.status === 'number' && cuerpo.status >= 400 && cuerpo.status < 500) {
      return {
        statusCode: cuerpo.status,
        error: HttpStatus[cuerpo.status] ?? 'ERROR',
        mensaje: cuerpo.status === 413 ? 'Cuerpo demasiado grande (maximo 1 MB; los archivos van por multipart)' : 'Cuerpo de la solicitud invalido',
      };
    }
    if (error instanceof ErrorCifrado) {
      this.logger.error(`ErrorCifrado: ${error.message}`);
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      this.logger.error(`Prisma ${error.code} sin SQLSTATE`);
    } else if (error instanceof Prisma.PrismaClientValidationError) {
      // El mensaje de validacion de Prisma incluye los argumentos: no se loguea.
      this.logger.error('PrismaClientValidationError (argumentos omitidos)');
    } else if (error instanceof Error && error.name.startsWith('PrismaClient')) {
      this.logger.error(`${error.name} (mensaje omitido)`);
    } else {
      // Sin instanceof Error: errores de otro realm (modulos nativos) no lo cumplen.
      const e = (error ?? {}) as { name?: unknown; message?: unknown; stack?: unknown };
      this.logger.error(
        typeof e.message === 'string' ? `${typeof e.name === 'string' ? e.name : 'Error'}: ${e.message}` : 'Error no identificado',
        typeof e.stack === 'string' ? e.stack : undefined,
      );
    }
    return { statusCode: 500, error: 'INTERNAL_SERVER_ERROR', mensaje: 'Error interno' };
  }
}
