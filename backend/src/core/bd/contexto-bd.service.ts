import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Rol } from '@prisma/client';
import { ClsService } from 'nestjs-cls';

import { LlaveroService } from '../crypto/llavero.service';
import { PrismaService } from '../prisma/prisma.service';
import { extensionCifrado } from './cifrado.extension';

function crearCliente(prisma: PrismaService, llavero: LlaveroService) {
  return prisma.$extends(extensionCifrado(() => llavero.llavero));
}

/** Cliente con la extension de cifrado. */
export type ClienteBd = ReturnType<typeof crearCliente>;
/** Cliente de la transaccion de la request (con contexto RLS). */
export type Tx = Parameters<Parameters<ClienteBd['$transaction']>[0]>[0];

/** Identidad del actor (del JWT). `id` = usuarios.id, para cualquier rol. */
export interface UsuarioActual {
  id: string;
  rol: Rol;
}

const CLAVE_TX = 'bd.tx';
const CLAVE_USUARIO = 'bd.usuario';
const CLAVE_DESPUES = 'bd.despues';

/**
 * Acceso a datos con contexto RLS (requisitos_02_apis.md 1).
 *
 * El RlsInterceptor llama a enTransaccion por cada request autenticada: abre
 * una transaccion interactiva, ejecuta set_config(app.current_usuario_id) y
 * set_config(app.current_rol) (parametrizados, locales a la transaccion),
 * verifica acceso_vigente() y deja el tx en CLS. Los repositorios/servicios
 * llaman a tx(): nunca al PrismaClient global. Sin transaccion activa, tx()
 * lanza (falla cerrado en vez de consultar sin contexto).
 *
 * Errores al COMMIT: antes de confirmar se ejecuta SET CONSTRAINTS ALL
 * IMMEDIATE (los triggers diferidos fallan como consulta, con SQLSTATE). Lo
 * que aun falle en el COMMIT sale del $transaction y lo traduce el filtro
 * global (sin SQLSTATE: 500 generico).
 *
 * sinContexto(): unico acceso sin variables de contexto, para lo que la BD
 * diseño asi: login (credenciales_login, sesiones), portal publico
 * (perfiles_publicos, disponibilidad_publica), jobs (funciones de job) y
 * /salud. Sobre tablas con RLS devuelve 0 filas.
 */
@Injectable()
export class ContextoBd {
  private readonly cliente: ClienteBd;
  private readonly logger = new Logger(ContextoBd.name);

  constructor(
    prisma: PrismaService,
    llavero: LlaveroService,
    private readonly cls: ClsService,
  ) {
    this.cliente = crearCliente(prisma, llavero);
  }

  async enTransaccion<T>(usuario: UsuarioActual, fn: () => Promise<T>): Promise<T> {
    const correr = async () => {
      const despues: (() => unknown)[] = [];
      this.cls.set(CLAVE_DESPUES, despues);
      const resultado = await this.transaccion(usuario, fn);
      // Solo con COMMIT exitoso: eventos de dominio y avisos.
      for (const accion of despues) {
        try {
          await accion();
        } catch (error) {
          this.logger.error(`Accion posterior al COMMIT fallo: ${(error as { name?: string }).name ?? 'Error'}`);
        }
      }
      return resultado;
    };
    return this.cls.isActive() ? correr() : this.cls.run(correr);
  }

  /** Ejecuta fn despues del COMMIT de la request actual (nunca si hay rollback). */
  alConfirmar(accion: () => unknown): void {
    const despues = this.cls.isActive() ? this.cls.get<(() => unknown)[] | undefined>(CLAVE_DESPUES) : undefined;
    if (!despues) {
      throw new Error('alConfirmar fuera de una transaccion de request');
    }
    despues.push(accion);
  }

  private transaccion<T>(usuario: UsuarioActual, fn: () => Promise<T>): Promise<T> {
    return this.cliente.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_usuario_id', ${usuario.id}, true),
                                    set_config('app.current_rol', ${usuario.rol}, true)`;
        const [{ vigente }] = await tx.$queryRaw<[{ vigente: boolean }]>`SELECT acceso_vigente() AS vigente`;
        if (!vigente) {
          throw new UnauthorizedException('La sesion no tiene acceso vigente');
        }
        this.cls.set(CLAVE_TX, tx);
        this.cls.set(CLAVE_USUARIO, usuario);
        try {
          const resultado = await fn();
          // Las reglas diferidas (pacientes_practicante_requiere_consentimiento)
          // se evaluan aqui y no en el COMMIT: Prisma entrega los errores del
          // COMMIT sin SQLSTATE; como consulta, llegan con su codigo al filtro.
          await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
          return resultado;
        } finally {
          this.cls.set(CLAVE_TX, undefined);
        }
      },
      { maxWait: 5_000, timeout: 20_000 },
    );
  }

  /** Transaccion de la request actual (con contexto RLS). */
  tx(): Tx {
    const tx = this.cls.isActive() ? this.cls.get<Tx | undefined>(CLAVE_TX) : undefined;
    if (!tx) {
      throw new Error('Consulta sin contexto RLS: usar dentro de una request autenticada');
    }
    return tx;
  }

  usuario(): UsuarioActual {
    const usuario = this.cls.isActive() ? this.cls.get<UsuarioActual | undefined>(CLAVE_USUARIO) : undefined;
    if (!usuario) {
      throw new Error('Sin usuario en contexto');
    }
    return usuario;
  }

  /** Sin contexto RLS: solo login, portal publico, jobs y salud (ver arriba). */
  sinContexto(_motivo: 'login' | 'publico' | 'job' | 'salud'): ClienteBd {
    return this.cliente;
  }
}

/** Lectura vacia -> 404. */
export function encontrado<T>(valor: T | null | undefined, que = 'Recurso'): T {
  if (valor === null || valor === undefined) {
    throw new NotFoundException(`${que} no encontrado`);
  }
  return valor;
}
