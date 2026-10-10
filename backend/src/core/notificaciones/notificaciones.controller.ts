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
    return this.bd.tx().notificacion.findMany({ orderBy: { creadaEn: 'desc' }, take: 200 });
  }
}
