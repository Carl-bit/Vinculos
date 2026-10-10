import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { conflicto, esSqlstate } from '../../core/errores/sqlstate';
import type {
  DatosPrivadosDto,
  EditarPerfilDto,
  EditarTipoAtencionDto,
  PerfilDto,
  TarifaDto,
  TipoAtencionDto,
  TrayectoriaDto,
} from './dto/equipo.dto';

const VISTA_PRIVADOS = {
  usuarioId: true,
  rut: true,
  banco: true,
  tipoCuenta: true,
  numeroCuenta: true,
  titular: true,
  updatedAt: true,
} satisfies Prisma.ProfesionalDatosPrivadosSelect;

type Privados = Prisma.ProfesionalDatosPrivadosGetPayload<{ select: typeof VISTA_PRIVADOS }>;

const vistaPrivados = (d: Privados) => ({
  usuarioId: d.usuarioId,
  rut: texto(d.rut),
  banco: texto(d.banco),
  tipoCuenta: texto(d.tipoCuenta),
  numeroCuenta: texto(d.numeroCuenta),
  titular: texto(d.titular),
  updatedAt: d.updatedAt,
});

/**
 * Perfil profesional autogestionado (requisitos_02_apis.md 6): perfil
 * publico, trayectoria (ADMIN verifica), datos privados cifrados, tarifas
 * (historial, sin UPDATE) y tipos de atencion (catalogo de ADMIN).
 */
@Injectable()
export class EquipoService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  async perfil(profesionalId: string) {
    return encontrado(await this.bd.tx().profesional.findUnique({ where: { usuarioId: profesionalId } }), 'Perfil');
  }

  /** El propio PROFESIONAL crea o edita su perfil (publicar exige tarifa general: 422). */
  guardarMiPerfil(dto: PerfilDto) {
    const usuarioId = this.bd.usuario().id;
    return this.bd.tx().profesional.upsert({ where: { usuarioId }, create: { usuarioId, ...dto }, update: dto });
  }

  /** ADMIN/GESTION corrigen el perfil; publicarlo es solo del propio (403). */
  async editarPerfil(profesionalId: string, dto: EditarPerfilDto) {
    await this.perfil(profesionalId);
    return this.bd.tx().profesional.update({ where: { usuarioId: profesionalId }, data: dto });
  }

  /**
   * Margen de traslado (el propio y ADMIN/GESTION). Cambiarlo no mueve citas:
   * GET /profesionales/:id/conflictos-margen lista las que quedan en conflicto.
   */
  async margen(profesionalId: string, margenTrasladoMin: number | null) {
    await this.perfil(profesionalId);
    return this.bd.tx().profesional.update({ where: { usuarioId: profesionalId }, data: { margenTrasladoMin } });
  }

  trayectoria(profesionalId: string) {
    return this.bd.tx().profesionalTrayectoria.findMany({ where: { profesionalId }, orderBy: [{ anio: 'desc' }, { titulo: 'asc' }] });
  }

  crearTrayectoria(dto: TrayectoriaDto) {
    return this.bd.tx().profesionalTrayectoria.create({ data: { profesionalId: this.bd.usuario().id, ...dto } });
  }

  /** Cualquier edicion del propio la des-verifica (trigger). */
  async editarTrayectoria(id: string, dto: TrayectoriaDto) {
    const tx = this.bd.tx();
    encontrado(await tx.profesionalTrayectoria.findFirst({ where: { id, profesionalId: this.bd.usuario().id } }), 'Trayectoria');
    return tx.profesionalTrayectoria.update({ where: { id }, data: dto });
  }

  async eliminarTrayectoria(id: string) {
    const { count } = await this.bd.tx().profesionalTrayectoria.deleteMany({ where: { id, profesionalId: this.bd.usuario().id } });
    encontrado(count || null, 'Trayectoria');
    return { eliminados: count };
  }

  /** Solo ADMIN (trigger: ADMIN solo toca la verificacion). */
  async verificarTrayectoria(id: string, verificado: boolean) {
    const tx = this.bd.tx();
    encontrado(await tx.profesionalTrayectoria.findUnique({ where: { id } }), 'Trayectoria');
    return tx.profesionalTrayectoria.update({ where: { id }, data: { verificado } });
  }

  async datosPrivados(profesionalId: string) {
    return vistaPrivados(
      encontrado(await this.bd.tx().profesionalDatosPrivados.findUnique({ where: { usuarioId: profesionalId }, select: VISTA_PRIVADOS }), 'Datos privados'),
    );
  }

  /** Solo el propio (PROFESIONAL o PRACTICANTE). RUT con indice ciego unico. */
  async guardarMisDatosPrivados(dto: DatosPrivadosDto) {
    const usuarioId = this.bd.usuario().id;
    const datos = {
      rut: claro(dto.rut),
      rutHmac: dto.rut ? this.llavero.hmacRut(dto.rut) : undefined,
      banco: claro(dto.banco),
      tipoCuenta: claro(dto.tipoCuenta),
      numeroCuenta: claro(dto.numeroCuenta),
      titular: claro(dto.titular),
    };
    const fila = await this.bd
      .tx()
      .profesionalDatosPrivados.upsert({ where: { usuarioId }, create: { usuarioId, ...datos }, update: datos, select: VISTA_PRIVADOS })
      .catch((error: unknown) => {
        throw esSqlstate(error, '23505') ? conflicto('profesional_datos_privados_rut_hmac_key') : error;
      });
    return vistaPrivados(fila);
  }

  tarifas(profesionalId: string) {
    return this.bd.tx().tarifa.findMany({ where: { profesionalId }, orderBy: [{ vigenteDesde: 'desc' }, { createdAt: 'desc' }] });
  }

  /** Historial: una tarifa nueva es una fila nueva (sin UPDATE ni DELETE). */
  crearTarifa(dto: TarifaDto) {
    return this.bd.tx().tarifa.create({ data: { profesionalId: this.bd.usuario().id, ...dto } });
  }

  tiposAtencion() {
    return this.bd.tx().tipoAtencion.findMany({ orderBy: { nombre: 'asc' } });
  }

  crearTipoAtencion(dto: TipoAtencionDto) {
    return this.bd.tx().tipoAtencion.create({ data: dto });
  }

  editarTipoAtencion(id: string, dto: EditarTipoAtencionDto) {
    return this.bd.tx().tipoAtencion.update({ where: { id }, data: dto });
  }

  /** ADMIN: reemplaza los tipos de atencion que ofrece el profesional. */
  async asignarTiposAtencion(profesionalId: string, tipoAtencionIds: string[]) {
    const tx = this.bd.tx();
    await tx.profesionalTipoAtencion.deleteMany({ where: { profesionalId } });
    await tx.profesionalTipoAtencion.createMany({ data: tipoAtencionIds.map((tipoAtencionId) => ({ profesionalId, tipoAtencionId })) });
    return tx.profesionalTipoAtencion.findMany({ where: { profesionalId } });
  }

}
