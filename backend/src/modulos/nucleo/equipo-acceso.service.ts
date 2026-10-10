import { Injectable } from '@nestjs/common';
import type { Rol } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import type { IniciarBajaDto, OtorgarAccesoDto } from './dto/nucleo.dto';

/**
 * Accesos de practicantes, bajas, bandeja de reasignacion, alertas y
 * directorio. Todas las escrituras con reglas de estado pasan por funciones
 * SECURITY DEFINER de la BD (sin GRANT directo).
 */
@Injectable()
export class EquipoAccesoService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  practicantes() {
    return this.bd.tx().practicante.findMany({ orderBy: { fechaInicio: 'desc' } });
  }

  /**
   * Otorga o extiende el acceso. Reactivar un practicante son dos pasos en la
   * BD (cambiar_supervisor si su supervision cerro, luego
   * otorgar_acceso_practicante): aqui van juntos, en la misma transaccion.
   */
  async otorgarAcceso(practicanteId: string, dto: OtorgarAccesoDto) {
    const tx = this.bd.tx();
    let avisos = 0;
    if (dto.supervisorId) {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT cambiar_supervisor(${practicanteId}::uuid, ${dto.supervisorId}::uuid) AS n`;
      avisos = n;
    }
    await tx.$executeRaw`SELECT otorgar_acceso_practicante(${practicanteId}::uuid, ${dto.fechaExpiracion})`;
    return { practicanteId, fechaExpiracion: dto.fechaExpiracion, avisosCambioSupervisor: avisos };
  }

  async revocarAcceso(practicanteId: string, motivo: string) {
    await this.bd.tx().$executeRaw`SELECT revocar_acceso_practicante(${practicanteId}::uuid, ${motivo})`;
    return { practicanteId, revocado: true };
  }

  historialAccesos(practicanteId: string) {
    return this.bd.tx().historialAccesoPracticante.findMany({ where: { practicanteId }, orderBy: { createdAt: 'asc' } });
  }

  async iniciarBaja(dto: IniciarBajaDto) {
    const [{ n }] = await this.bd.tx().$queryRaw<[{ n: number }]>`
      SELECT iniciar_baja_profesional(${dto.usuarioId}::uuid, ${dto.fechaEfectiva}) AS n`;
    return { usuarioId: dto.usuarioId, fechaEfectiva: dto.fechaEfectiva, citasPorReprogramar: n };
  }

  bajas() {
    return this.bd.tx().baja.findMany({ orderBy: { fechaEfectiva: 'asc' } });
  }

  /** ADMIN/GESTION con nombre; supervisor solo sus practicantes, con codigo seudonimo. */
  pacientesPorReasignar() {
    return this.bd.tx().$queryRaw<
      {
        paciente_id: string;
        ficha_id: string | null;
        codigo: string;
        nombre: string | null;
        apellido: string | null;
        tratante_id: string;
        motivo: string;
        derivacion_abierta: boolean;
      }[]
    >`SELECT * FROM pacientes_por_reasignar()`;
  }

  alertas() {
    return this.bd.tx().alertaInterna.findMany({ orderBy: [{ atendidaEn: { sort: 'desc', nulls: 'first' } }, { creadaEn: 'desc' }] });
  }

  async atenderAlerta(id: string) {
    await this.bd.tx().$executeRaw`SELECT atender_alerta(${id}::uuid)`;
    return { id, atendida: true };
  }

  /** Telefono cifrado: solo llega a ADMIN/GESTION; AAD usuarios:telefono:<id>. */
  async directorio() {
    const filas = await this.bd.tx().$queryRaw<
      { id: string; nombre: string; rol: Rol; tipos_atencion: string[]; email: string | null; telefono: Uint8Array | null }[]
    >`SELECT id, nombre, rol, tipos_atencion, email, telefono FROM directorio_interno()`;
    return filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      rol: f.rol,
      tiposAtencion: f.tipos_atencion,
      email: f.email,
      telefono: this.llavero.descifrarCampo(f.telefono, 'usuarios', 'telefono', f.id),
    }));
  }

  miEquipoTratante() {
    return this.bd.tx().$queryRaw<{ id: string; nombre: string | null }[]>`SELECT id, nombre FROM mi_equipo_tratante()`;
  }
}
