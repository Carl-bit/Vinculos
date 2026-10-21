import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';

import { CobrosController } from './cobros.controller';
import { CobrosService } from './cobros.service';
import {
  PagoPortalController,
  PagosEnlaceController,
  PasarelaController,
  ReservasPublicoController,
  TransferenciasController,
} from './confirmacion-pago.controller';
import { ConfirmacionPagoService } from './confirmacion-pago.service';

/**
 * Cobros (02h). Depende de Agenda y Espacios (citas) solo a traves de la BD
 * (monto fijado al confirmar, vista estado_pago_citas): no importa servicios
 * de otros modulos. 03b-3.1: confirmacion de la cita por medio de pago
 * (funciones de la BD; la pasarela es una interfaz de core).
 */
@Module({
  imports: [
    // Comprobantes: un archivo por request, corte en streaming al pasar ADJUNTO_MAX_MB (413); un campo (el token de la reserva).
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: { fileSize: config.getOrThrow<number>('ADJUNTO_MAX_MB') * 1024 * 1024, files: 1, fields: 1 },
      }),
    }),
  ],
  controllers: [CobrosController, ReservasPublicoController, PagosEnlaceController, PagoPortalController, TransferenciasController, PasarelaController],
  providers: [CobrosService, ConfirmacionPagoService],
})
export class CobrosModule {}
