import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';

import { claro } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import type { ContactoEmergenciaDto } from './dto/contactos-emergencia.dto';

interface FilaDatos {
  id: string;
  nombre: Uint8Array;
  parentesco: string;
  telefono: Uint8Array;
}

/**
 * Punto 38: contactos de emergencia. Los escribe el paciente (RLS:
 * contacto_emergencia_propio). Nombre y telefono no se leen por la tabla
 * (sin GRANT de esas columnas): llegan cifrados desde
 * datos_contactos_emergencia(), que exige motivo y audita al tratante.
 */
@Injectable()
export class ContactosEmergenciaService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  /** PACIENTE: el suyo. RESPONSABLE: el menor que indica (la RLS valida que este a su cargo). */
  private async pacienteDelPortal(pacienteId?: string): Promise<string> {
    if (this.bd.usuario().rol === 'RESPONSABLE') {
      if (!pacienteId) throw new BadRequestException('Indique pacienteId (menor a su cargo)');
      return pacienteId;
    }
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string | null }]>`SELECT app_paciente_id() AS id`;
    return encontrado(id, 'Paciente');
  }

  private async datos(pacienteId: string, motivo: string | null) {
    const filas = await this.bd.tx().$queryRaw<FilaDatos[]>`SELECT * FROM datos_contactos_emergencia(${pacienteId}::uuid, ${motivo})`;
    return filas.map((f) => ({
      id: f.id,
      nombre: this.llavero.descifrarCampo(f.nombre, 'contactos_emergencia', 'nombre', f.id)!,
      parentesco: f.parentesco,
      telefono: this.llavero.descifrarCampo(f.telefono, 'contactos_emergencia', 'telefono', f.id)!,
    }));
  }

  async mios(pacienteId?: string) {
    return this.datos(await this.pacienteDelPortal(pacienteId), null);
  }

  async crear(dto: ContactoEmergenciaDto) {
    const pacienteId = await this.pacienteDelPortal(dto.pacienteId);
    // createMany: sin RETURNING (app_user no lee nombre ni telefono).
    await this.bd.tx().contactoEmergencia.createMany({
      data: [{ id: randomUUID(), pacienteId, nombre: claro(dto.nombre), parentesco: dto.parentesco, telefono: claro(dto.telefono) }],
    });
    return this.datos(pacienteId, null);
  }

  async editar(id: string, dto: ContactoEmergenciaDto) {
    const tx = this.bd.tx();
    const fila = encontrado(await tx.contactoEmergencia.findUnique({ where: { id }, select: { pacienteId: true } }), 'Contacto de emergencia');
    const pacienteId = await this.pacienteDelPortal(dto.pacienteId ?? fila.pacienteId);
    await tx.contactoEmergencia.update({
      where: { id },
      data: { nombre: claro(dto.nombre), parentesco: dto.parentesco, telefono: claro(dto.telefono), updatedAt: new Date() },
      select: { id: true },
    });
    return this.datos(pacienteId, null);
  }

  async eliminar(id: string) {
    // La RLS de DELETE deja solo los del portal propio; otra fila cuenta 0 (404).
    const { count } = await this.bd.tx().contactoEmergencia.deleteMany({ where: { id } });
    if (count === 0) encontrado(null, 'Contacto de emergencia');
  }

  /** Tratante: existencia y parentesco (la RLS limita a acceso clinico vigente). */
  resumen(pacienteId: string) {
    return this.bd.tx().contactoEmergencia.findMany({ where: { pacienteId }, select: { id: true, parentesco: true }, orderBy: { createdAt: 'asc' } });
  }

  /** Tratante en una emergencia: nombre y telefono; la BD exige motivo y lo audita. */
  emergencia(pacienteId: string, motivo: string) {
    return this.datos(pacienteId, motivo);
  }

  async retorno(pacienteId: string) {
    const [r] = await this.bd.tx().$queryRaw<
      { profesional_principal_id: string; principal_disponible: boolean; pide_volver: boolean; tratante_actual_id: string }[]
    >`
      SELECT profesional_principal_id, principal_disponible, pide_volver, tratante_actual_id FROM retorno_atencion_temporal(${pacienteId}::uuid)`;
    if (!r) return null;
    return {
      profesionalPrincipalId: r.profesional_principal_id,
      principalDisponible: r.principal_disponible,
      pideVolver: r.pide_volver,
      tratanteActualId: r.tratante_actual_id,
    };
  }

  async pedir(pacienteId: string) {
    await this.bd.tx().$executeRaw`SELECT pedir_contacto_emergencia(${pacienteId}::uuid)`;
  }
}
