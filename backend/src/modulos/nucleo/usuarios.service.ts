import { randomUUID } from 'node:crypto';

import { Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import type { CambiarPasswordDto, CrearUsuarioDto, EditarConfiguracionDto, EditarMiCuentaDto, EditarUsuarioDto } from './dto/nucleo.dto';

const COSTO_BCRYPT = 12;

/** Nunca password_hash fuera del servicio. */
const VISTA = {
  id: true,
  email: true,
  nombre: true,
  telefono: true,
  rol: true,
  activo: true,
  fechaExpiracionAcceso: true,
  pacienteId: true,
  desactivadoEn: true,
  cerradaEn: true,
  createdAt: true,
} satisfies Prisma.UsuarioSelect;

type FilaVista = Prisma.UsuarioGetPayload<{ select: typeof VISTA }>;

function vista(u: FilaVista) {
  return { ...u, telefono: texto(u.telefono) };
}

@Injectable()
export class UsuariosService {
  constructor(private readonly bd: ContextoBd) {}

  /**
   * Alta (solo ADMIN; la RLS lo impone). Id generado aqui (AAD del telefono).
   * PRACTICANTE: perfil de practica + supervisor (cambiar_supervisor) +
   * OTORGADO en la bitacora (otorgar_acceso_practicante), en la misma
   * transaccion: nunca queda un practicante sin supervisor.
   */
  async crear(dto: CrearUsuarioDto) {
    const tx = this.bd.tx();
    const id = randomUUID();
    const practicante = dto.rol === 'PRACTICANTE';
    const usuario = await tx.usuario.create({
      data: {
        id,
        email: dto.email,
        nombre: dto.nombre,
        rol: dto.rol,
        passwordHash: await bcrypt.hash(dto.password, COSTO_BCRYPT),
        telefono: claro(dto.telefono),
        fechaExpiracionAcceso: practicante ? dto.fechaExpiracionAcceso : null,
        pacienteId: dto.rol === 'PACIENTE' ? dto.pacienteId : null,
      },
      select: VISTA,
    });
    if (practicante) {
      await tx.practicante.create({
        data: { usuarioId: id, fechaInicio: dto.fechaInicioPractica!, fechaTerminoPractica: dto.fechaTerminoPractica! },
      });
      await tx.$executeRaw`SELECT cambiar_supervisor(${id}::uuid, ${dto.supervisorId}::uuid)`;
      await tx.$executeRaw`SELECT otorgar_acceso_practicante(${id}::uuid, ${dto.fechaExpiracionAcceso})`;
    }
    return vista(usuario);
  }

  async miCuenta() {
    const u = await this.bd.tx().usuario.findUnique({ where: { id: this.bd.usuario().id }, select: VISTA });
    return vista(encontrado(u, 'Usuario'));
  }

  async editarMiCuenta(dto: EditarMiCuentaDto) {
    const u = await this.bd.tx().usuario.update({
      where: { id: this.bd.usuario().id },
      data: {
        email: dto.email,
        nombre: dto.nombre,
        telefono: dto.telefono === undefined ? undefined : claro(dto.telefono),
      },
      select: VISTA,
    });
    return vista(u);
  }

  /** Cambiar la contraseña revoca las sesiones de refresh (trigger de la BD). */
  async cambiarPassword(dto: CambiarPasswordDto): Promise<void> {
    const tx = this.bd.tx();
    const id = this.bd.usuario().id;
    const { passwordHash } = encontrado(await tx.usuario.findUnique({ where: { id }, select: { passwordHash: true } }), 'Usuario');
    if (!passwordHash || !(await bcrypt.compare(dto.actual, passwordHash))) {
      throw new UnauthorizedException('La contraseña actual no coincide');
    }
    await tx.usuario.update({ where: { id }, data: { passwordHash: await bcrypt.hash(dto.nueva, COSTO_BCRYPT) }, select: { id: true } });
  }

  async listar() {
    const filas = await this.bd.tx().usuario.findMany({ select: VISTA, orderBy: [{ cerradaEn: { sort: 'desc', nulls: 'first' } }, { nombre: 'asc' }] });
    return filas.map(vista);
  }

  async obtener(id: string) {
    return vista(encontrado(await this.bd.tx().usuario.findUnique({ where: { id }, select: VISTA }), 'Usuario'));
  }

  /**
   * Rol y activo (solo ADMIN: trigger usuarios_campos_protegidos). Reactivar
   * dentro de la gracia es activo = true; una cuenta cerrada no cambia
   * (23001 -> 409: quien vuelve recibe cuenta nueva). Los practicantes se
   * activan, extienden y revocan por /practicantes (bitacora de accesos).
   */
  async editar(id: string, dto: EditarUsuarioDto) {
    const tx = this.bd.tx();
    const actual = encontrado(await tx.usuario.findUnique({ where: { id }, select: { rol: true } }), 'Usuario');
    if (actual.rol === 'PRACTICANTE' && dto.activo !== undefined) {
      throw new UnprocessableEntityException('Practicantes: activar o revocar en /practicantes/:id/acceso y /practicantes/:id/revocacion');
    }
    return vista(await tx.usuario.update({ where: { id }, data: { rol: dto.rol, activo: dto.activo }, select: VISTA }));
  }

  obtenerConfiguracion() {
    return this.bd.tx().configuracionCentro.findUniqueOrThrow({ where: { id: true } });
  }

  editarConfiguracion(dto: EditarConfiguracionDto) {
    return this.bd.tx().configuracionCentro.update({ where: { id: true }, data: dto });
  }
}
