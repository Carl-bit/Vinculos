import 'reflect-metadata';

import { Prisma } from '@prisma/client';
import type { ClsService } from 'nestjs-cls';

import { FiltroErrores } from './filtro-errores';

const filtro = new FiltroErrores({ isActive: () => false } as unknown as ClsService);
const prisma = (code: string) => new Prisma.PrismaClientKnownRequestError('sin conexion', { code, clientVersion: 'test' });

describe('FiltroErrores', () => {
  it('P2028 (pool saturado en maxWait) -> 503, no 500', () => {
    expect(filtro.traducir(prisma('P2028'))).toEqual(expect.objectContaining({ statusCode: 503, error: 'SERVICE_UNAVAILABLE' }));
  });

  it('otro error de Prisma sin SQLSTATE sigue siendo 500 generico', () => {
    expect(filtro.traducir(prisma('P2024'))).toEqual({ statusCode: 500, error: 'INTERNAL_SERVER_ERROR', mensaje: 'Error interno' });
  });
});
