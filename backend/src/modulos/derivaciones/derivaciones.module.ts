import { Module } from '@nestjs/common';

import { ConsentimientosController, DerivacionesController } from './derivaciones.controller';
import { DerivacionesService } from './derivaciones.service';

/** Derivaciones, consentimientos y avisos (02f). Escritura solo via funciones de la BD. */
@Module({
  controllers: [DerivacionesController, ConsentimientosController],
  providers: [DerivacionesService],
})
export class DerivacionesModule {}
