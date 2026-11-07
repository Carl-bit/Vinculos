import { Controller, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';

import { Publico } from '../../core/auth/decoradores';
import type { ResultadoJob } from '../../core/jobs/jobs.service';
import { NotificacionesService } from '../../core/notificaciones/notificaciones.service';
import { RecordatoriosService } from './recordatorios.service';

/**
 * Solo desarrollo y tests (JOBS_MANUALES, prohibido en produccion por
 * validarEntorno): corre un job al instante en vez de esperar su cron. Lo usa
 * Playwright para probar el recordatorio por correo de punta a punta. Apagado
 * responde 404 (como si no existiera). Fuera del contrato OpenAPI.
 */
@ApiExcludeController()
@Controller('pruebas/jobs')
@Publico()
export class JobsPruebaController {
  constructor(
    private readonly config: ConfigService,
    private readonly recordatorios: RecordatoriosService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  @Post(':nombre')
  @HttpCode(200)
  async correr(@Param('nombre') nombre: string): Promise<{ recordatorios: ResultadoJob; correos: ResultadoJob }> {
    if (!this.config.get<boolean>('JOBS_MANUALES') || nombre !== 'enviar_recordatorios') {
      throw new NotFoundException();
    }
    // Registra los recordatorios y envia los correos encolados (lo que harian sus dos crons).
    // El envio toma la cola de a 50 (los mas antiguos primero): se repite hasta vaciarla.
    const recordatorios = await this.recordatorios.enviarRecordatorios();
    let enviados = 0;
    let corrio = false;
    for (let vuelta = 0; vuelta < 20; vuelta++) {
      const r = await this.notificaciones.enviarPendientes();
      corrio ||= r.corrio;
      if (!r.corrio || !r.total) break;
      enviados += r.total;
    }
    const correos: ResultadoJob = corrio ? { corrio, total: enviados } : { corrio: false };
    return { recordatorios, correos };
  }
}
