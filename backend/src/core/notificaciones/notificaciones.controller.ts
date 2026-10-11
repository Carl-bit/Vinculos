import { Controller, Get } from '@nestjs/common';

import { Roles } from '../auth/decoradores';
import { ContextoBd } from '../bd/contexto-bd.service';

/** Registro de notificaciones: ADMIN/GESTION todas; cada destinatario las suyas (RLS). */
@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly bd: ContextoBd) {}

  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE')
  listar() {
    // Sin creadaPorId: un candidato de derivacion no debe saber quien rechazo antes (02h).
    return this.bd.tx().notificacion.findMany({
      select: { id: true, tipo: true, pacienteId: true, usuarioId: true, referenciaId: true, estado: true, creadaEn: true, procesadaEn: true },
      orderBy: { creadaEn: 'desc' },
      take: 200,
    });
  }
}
