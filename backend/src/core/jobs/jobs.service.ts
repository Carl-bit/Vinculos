import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ContextoBd, type Tx } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';

export type ResultadoJob = { corrio: false } | { corrio: true; total: number };

/**
 * Jobs de la API (requisitos_02_apis.md 8). Corren SIN contexto de usuario:
 * solo llaman funciones de la BD diseñadas para eso (SECURITY DEFINER, sin
 * acceso_vigente), que son idempotentes y usan SKIP LOCKED. Ademas cada job
 * toma un advisory lock de transaccion propio: si otra instancia lo tiene, la
 * corrida se omite (una sola instancia corriendo por job).
 *
 * Sus efectos quedan en la BD (derivacion_candidatos EXPIRADA, historial
 * EXPIRADO, bajas.procesada_en, avisos CONFORME tacito); no escriben
 * accesos_ficha porque no hay usuario.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Jobs');

  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get<boolean>('JOBS_HABILITADOS')) {
      await this.procesarBajas();
    }
  }

  /** Corre fn bajo pg_try_advisory_xact_lock(job). Sin lock: no corre. */
  async conLock(nombre: string, fn: (tx: Tx) => Promise<number>): Promise<ResultadoJob> {
    const resultado = await this.bd.sinContexto('job').$transaction(
      async (tx) => {
        const [{ tomado }] = await tx.$queryRaw<[{ tomado: boolean }]>`
          SELECT pg_try_advisory_xact_lock(hashtext(${'vinculos:job:' + nombre})) AS tomado`;
        if (!tomado) {
          return { corrio: false } as const;
        }
        return { corrio: true, total: await fn(tx) } as const;
      },
      { timeout: 120_000 },
    );
    if (resultado.corrio) {
      this.logger.log(`${nombre}: ${resultado.total}`);
    } else {
      this.logger.log(`${nombre}: omitido (otra instancia tiene el lock)`);
    }
    return resultado;
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'expirar_ofertas_derivacion' })
  expirarOfertas(): Promise<ResultadoJob> {
    // Incluye solicitudes de consentimiento vencidas (VENCIDO + siguiente candidato).
    return this.conLock('expirar_ofertas_derivacion', async (tx) => {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT expirar_ofertas_derivacion() AS n`;
      return n;
    });
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'avisar_consentimientos_por_vencer' })
  avisarConsentimientosPorVencer(): Promise<ResultadoJob> {
    // 02i: una vez por solicitud, pasada la mitad de su plazo (aviso legal: no se desactiva).
    return this.conLock('avisar_consentimientos_por_vencer', async (tx) => {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT avisar_consentimientos_por_vencer() AS n`;
      return n;
    });
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'cerrar_avisos_vencidos' })
  cerrarAvisosVencidos(): Promise<ResultadoJob> {
    // Avisos de cambio de supervisor sin respuesta -> CONFORME tacito.
    return this.conLock('cerrar_avisos_vencidos', async (tx) => {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT cerrar_avisos_vencidos() AS n`;
      return n;
    });
  }

  /**
   * Bajas, practicantes vencidos y cierre de cuentas fuera de gracia. Despues
   * alerta (log de error + alertas_internas) si una baja quedo pendiente
   * porque dejaria al centro sin ADMIN.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'procesar_bajas' })
  procesarBajas(): Promise<ResultadoJob> {
    return this.conLock('procesar_bajas', async (tx) => {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT procesar_bajas() AS n`;
      const [{ bloqueadas }] = await tx.$queryRaw<[{ bloqueadas: number }]>`SELECT alertar_bajas_sin_admin() AS bloqueadas`;
      if (bloqueadas > 0) {
        this.logger.error(`procesar_bajas: ${bloqueadas} baja(s) pendiente(s): dejarian al centro sin ADMIN activo`);
      }
      return n;
    });
  }

  /**
   * 03a: vence retenciones de solicitudes de hora sin verificar, borra
   * respuestas del match de solicitudes no concretadas pasado el plazo (D-6)
   * y elimina solicitudes vencidas antiguas.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'limpiar_solicitudes' })
  limpiarSolicitudes(): Promise<ResultadoJob> {
    return this.conLock('limpiar_solicitudes', async (tx) => {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT limpiar_solicitudes() AS n`;
      return n;
    });
  }

  /**
   * 03b-3.1: el vencimiento lo decide el servidor. Citas pendientes de pago o
   * retenidas (03b-3.2) con el plazo vencido -> LIBERADA, con aviso al
   * paciente si ya existe (HORA_LIBERADA). 03b-3.3: la que agendo el equipo
   * se mantiene con pago en el centro (si ya no cabe en la agenda, se libera).
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'liberar_reservas_vencidas' })
  liberarReservasVencidas(): Promise<ResultadoJob> {
    return this.conLock('liberar_reservas_vencidas', async (tx) => {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT liberar_reservas_vencidas() AS n`;
      return n;
    });
  }

  /** 03b-3.2: recordatorios de pago (48 h y 24 h antes) de las horas que agenda el equipo. */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'avisar_pagos_pendientes' })
  avisarPagosPendientes(): Promise<ResultadoJob> {
    return this.conLock('avisar_pagos_pendientes', async (tx) => {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT avisar_pagos_pendientes() AS n`;
      return n;
    });
  }

  /**
   * 03b-3.3: sesiones terminadas con saldo: aviso al paciente (bandeja y
   * correo, tambien sin cuenta si tiene correo) y al profesional, una vez por
   * cita. La lista del equipo y el bloqueo de agenda salen de la misma regla.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'avisar_deudas' })
  avisarDeudas(): Promise<ResultadoJob> {
    return this.conLock('avisar_deudas', async (tx) => {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT avisar_deudas() AS n`;
      return n;
    });
  }

  /**
   * 03a-2: purga mensajes internos mas antiguos que
   * configuracion_centro.retencion_mensajes_dias (default 365) y los hilos
   * que quedan vacios. La mensajeria no es el expediente.
   */
  @Cron('30 3 * * *', { name: 'purgar_mensajes_internos', timeZone: 'America/Santiago' })
  purgarMensajesInternos(): Promise<ResultadoJob> {
    return this.conLock('purgar_mensajes_internos', async (tx) => {
      const [{ n }] = await tx.$queryRaw<[{ n: number }]>`SELECT purgar_mensajes_internos() AS n`;
      return n;
    });
  }

  @Cron('0 3 * * *', { name: 'verificar_canarios', timeZone: 'America/Santiago' })
  async verificarCanarios(): Promise<ResultadoJob> {
    return this.conLock('verificar_canarios', async () => ((await this.llavero.verificarYRegistrar()) ? 1 : 0));
  }
}
