import { Module } from '@nestjs/common';

import { CobrosController } from './cobros.controller';
import { CobrosService } from './cobros.service';

/**
 * Cobros (02h). Depende de Agenda y Espacios (citas) solo a traves de la BD
 * (monto fijado al confirmar, vista estado_pago_citas): no importa servicios
 * de otros modulos.
 */
@Module({
  controllers: [CobrosController],
  providers: [CobrosService],
})
export class CobrosModule {}
