/**
 * Logger (pino) con request id y redaccion (cifrado.md, "Redaccion de logs").
 *
 * Nunca se loguean: campos de CAMPOS_CIFRADOS (en claro o cifrados), RUT,
 * rut_hmac, contraseñas, tokens, KEK/DEK. Los bodies no se loguean nunca; la
 * redaccion es la red de seguridad para objetos que alguien pase al logger
 * (hasta 3 niveles de anidacion) y para las cabeceras de autenticacion.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DestinationStream } from 'pino';
import type { Params } from 'nestjs-pino';

import { CAMPOS_CIFRADOS } from '../../common/crypto/registro';

export const DESTINO_LOGS = Symbol('DESTINO_LOGS');

const SENSIBLES = [
  ...new Set([
    ...CAMPOS_CIFRADOS.flatMap((c) => [c.campo, c.columna]),
    'rutHmac',
    'rut_hmac',
    'password',
    'passwordHash',
    'password_hash',
    'refreshToken',
    'accessToken',
    'token',
    'kek',
    'dek',
    'motivoCierre',
    'enlace',
  ]),
];

export const RUTAS_REDACTADAS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SENSIBLES.flatMap((k) => [k, `*.${k}`, `*.*.${k}`, `*.*.*.${k}`]),
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Id de la request: el de X-Request-Id si es un uuid, si no uno nuevo. Lo
 * comparten pino-http y nestjs-cls (se memoriza en req.id).
 */
export function idSolicitud(req: IncomingMessage & { id?: unknown }): string {
  if (typeof req.id !== 'string') {
    const cabecera = req.headers['x-request-id'];
    req.id = typeof cabecera === 'string' && UUID.test(cabecera) ? cabecera : randomUUID();
  }
  return req.id as string;
}

export function opcionesLogger(nivel: string, destino?: DestinationStream): Params {
  return {
    pinoHttp: [
      {
        level: nivel,
        genReqId: (req, res) => {
          const id = idSolicitud(req);
          res.setHeader('X-Request-Id', id);
          return id;
        },
        redact: { paths: RUTAS_REDACTADAS, censor: '[redactado]' },
        // Solo metodo, ruta (sin query: puede traer un RUT de busqueda) e id.
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            url: req.url.split('?')[0],
          }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      },
      destino ?? process.stdout,
    ],
  };
}
