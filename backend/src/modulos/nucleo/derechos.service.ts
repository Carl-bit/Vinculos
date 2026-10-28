import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { registrarAcceso } from '../../core/bd/auditoria';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { texto } from '../../core/bd/claro';
import { LlaveroService } from '../../core/crypto/llavero.service';
import type {
  AvanzarSolicitudDerechoDto,
  BloquearTratamientoDto,
  RegistrarSolicitudDerechoDto,
  SolicitudDerechoPublicaDto,
  SolicitudDerechoVista,
} from './dto/nucleo.dto';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import { ExportacionesService } from './exportaciones.service';

/**
 * AUD-01 (E2.3a, ARCOP-01): solicitudes de derechos de los titulares (Ley
 * 21.719) con plazo de 30 dias habiles (lo fija la BD con los feriados). Solo
 * ADMIN. Detalle y respuesta van cifrados; leer las de un paciente queda en
 * accesos_ficha (pueden traer datos de salud).
 */
@Injectable()
export class DerechosService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly correos: CorreosCuenta,
    private readonly exportaciones: ExportacionesService,
  ) {}

  /**
   * AUD-01 (E2.3b): formulario publico por RUT. Responde siempre lo mismo
   * (no revela si el RUT es de un paciente). Si lo es, la BD registra la
   * solicitud y el aviso va SOLO al correo ya registrado, despues de
   * responder (el tiempo de respuesta no delata nada). El correo no se cambia
   * aqui: si lo pide, el centro verifica la identidad y lo cambia.
   */
  async solicitudPublica(dto: SolicitudDerechoPublicaDto): Promise<{ mensaje: string }> {
    const mensaje =
      'Si el RUT corresponde a un paciente del centro, registramos tu solicitud y te escribiremos al correo que el centro tiene registrado. ' +
      'Si necesitas actualizar ese correo, el centro verificara tu identidad antes de cambiarlo.';
    if (dto.sitioWeb) return { mensaje };
    const id = randomUUID();
    const detalle = dto.detalle ? this.llavero.cifrarCampo(dto.detalle, 'solicitudes_derechos', 'detalle', id) : null;
    const [{ correo }] = await this.bd.sinContexto('publico').$queryRaw<[{ correo: string | null }]>`
      SELECT registrar_solicitud_publica(${id}::uuid, ${dto.tipo}::tipo_derecho, ${Buffer.from(this.llavero.hmacRut(dto.rut))},
                                         ${detalle}, ${dto.cambiarCorreo ?? false}) AS correo`;
    if (correo) {
      void this.correos.enviarAviso(
        correo,
        'Recibimos tu solicitud sobre tus datos personales',
        'Recibimos una solicitud sobre tus datos personales hecha desde el formulario del centro. ' +
          'El centro tiene 30 dias habiles para responderte y lo hara a este correo. ' +
          (dto.cambiarCorreo ? 'Pediste actualizar tu correo: el centro te contactara para verificar tu identidad antes de cambiarlo. ' : '') +
          'Si no hiciste esta solicitud, avisale al centro respondiendo este correo.',
      );
    }
    return { mensaje };
  }

  async solicitudes(): Promise<SolicitudDerechoVista[]> {
    const tx = this.bd.tx();
    const filas = await tx.solicitudDerecho.findMany({ orderBy: [{ venceEl: 'asc' }], take: 300 });
    const ids = [...new Set(filas.map((f) => f.pacienteId).filter((x): x is string => !!x))];
    const [pacientes, restantes] = await Promise.all([
      tx.paciente.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, apellido: true, bloqueoDesde: true } }),
      tx.$queryRaw<{ id: string; dias: number }[]>`
        SELECT id, dias_habiles_restantes(vence_el) AS dias FROM solicitudes_derechos WHERE estado IN ('RECIBIDA', 'EN_CURSO')`,
    ]);
    await registrarAcceso(
      tx,
      this.bd.usuario(),
      ids.map((pacienteId) => ({ pacienteId, recurso: 'solicitudes_derechos', accion: 'LECTURA' as const })),
    );
    const nombre = new Map(pacientes.map((p) => [p.id, `${p.nombre} ${p.apellido}`]));
    const bloqueado = new Set(pacientes.filter((p) => p.bloqueoDesde).map((p) => p.id));
    const dias = new Map(restantes.map((r) => [r.id, r.dias]));
    const exportaciones = new Map(
      (
        await Promise.all(
          (
            await tx.exportacionPaciente.findMany({
              where: { solicitudId: { in: filas.map((f) => f.id) } },
              select: { id: true, solicitudId: true },
              orderBy: { creadaEn: 'asc' },
            })
          ).map(async (e) => [e.solicitudId, await this.exportaciones.vista(e.id)] as const),
        )
      ).map(([k, v]) => [k, v]),
    );
    return filas.map((f) => ({
      id: f.id,
      tipo: f.tipo,
      pacienteId: f.pacienteId,
      pacienteNombre: f.pacienteId ? (nombre.get(f.pacienteId) ?? null) : null,
      pacienteBloqueado: !!f.pacienteId && bloqueado.has(f.pacienteId),
      canal: f.canal,
      estado: f.estado,
      recibidaEn: f.recibidaEn,
      venceEl: f.venceEl.toISOString().slice(0, 10),
      diasHabilesRestantes: dias.get(f.id) ?? null,
      detalle: texto(f.detalle),
      respuesta: texto(f.respuesta),
      resueltaEn: f.resueltaEn,
      pideCambioCorreo: f.pideCambioCorreo,
      exportacion: exportaciones.get(f.id) ?? null,
    }));
  }

  async registrar(dto: RegistrarSolicitudDerechoDto): Promise<SolicitudDerechoVista> {
    const id = randomUUID();
    const detalle = dto.detalle ? this.llavero.cifrarCampo(dto.detalle, 'solicitudes_derechos', 'detalle', id) : null;
    await this.bd.tx().$queryRaw`
      SELECT registrar_solicitud_derecho(${id}::uuid, ${dto.tipo}::tipo_derecho, ${dto.pacienteId ?? null}::uuid,
                                         ${dto.canal}::canal_solicitud_derecho, ${detalle})`;
    return encontrado(
      (await this.solicitudes()).find((s) => s.id === id),
      'Solicitud',
    );
  }

  async avanzar(id: string, dto: AvanzarSolicitudDerechoDto): Promise<SolicitudDerechoVista> {
    const respuesta = dto.respuesta ? this.llavero.cifrarCampo(dto.respuesta, 'solicitudes_derechos', 'respuesta', id) : null;
    await this.bd.tx().$executeRaw`
      SELECT avanzar_solicitud_derecho(${id}::uuid, ${dto.estado}::estado_solicitud_derecho, ${respuesta})`;
    return encontrado(
      (await this.solicitudes()).find((s) => s.id === id),
      'Solicitud',
    );
  }

  /** AUD-01 (E2.3c): bloquea el tratamiento (impide gestiones nuevas; lo agendado se mantiene). */
  async bloquear(pacienteId: string, dto: BloquearTratamientoDto) {
    await this.bd.tx().$executeRaw`SELECT bloquear_tratamiento(${pacienteId}::uuid, ${dto.motivo}, ${dto.solicitudId ?? null}::uuid)`;
    return this.estadoBloqueo(pacienteId);
  }

  async levantar(pacienteId: string) {
    await this.bd.tx().$executeRaw`SELECT levantar_bloqueo(${pacienteId}::uuid)`;
    return this.estadoBloqueo(pacienteId);
  }

  /** Cancelacion de datos perifericos con la solicitud: devuelve que se borro y que se conserva (y por que). */
  async cancelarPerifericos(pacienteId: string, solicitudId: string) {
    const [{ mensaje }] = await this.bd.tx().$queryRaw<[{ mensaje: string }]>`
      SELECT cancelar_datos_perifericos(${pacienteId}::uuid, ${solicitudId}::uuid) AS mensaje`;
    return { mensaje };
  }

  private async estadoBloqueo(pacienteId: string) {
    const p = encontrado(
      await this.bd.tx().paciente.findUnique({ where: { id: pacienteId }, select: { id: true, bloqueoDesde: true, bloqueoMotivo: true } }),
      'Paciente',
    );
    return { pacienteId: p.id, bloqueoDesde: p.bloqueoDesde, bloqueoMotivo: p.bloqueoMotivo };
  }
}
