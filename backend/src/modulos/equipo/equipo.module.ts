import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';

import {
  DocumentosPracticanteController,
  PerfilesController,
  SupervisionController,
  TiposAtencionController,
  TrayectoriaController,
} from './equipo.controller';
import { EquipoService } from './equipo.service';
import { EspecialidadesService } from './especialidades.service';
import { EspecialidadesController, MensajeriaInternaController } from './mensajeria-interna.controller';
import { MensajeriaInternaService } from './mensajeria-interna.service';
import { RegistroSisService } from './registro-sis.service';
import { SupervisionService } from './supervision.service';

/**
 * Equipo (02e): perfil, trayectoria, datos privados, tarifas, tipos de atencion y supervision.
 * 03a-2: especialidades del profesional y mensajeria interna del equipo.
 * 03b-4.2: registro en la Superintendencia de Salud (RNPI).
 */
@Module({
  imports: [
    // Respaldo de titulos: multer corta la subida al pasar ADJUNTO_MAX_MB (413). La foto usa su propio limite.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: { fileSize: config.getOrThrow<number>('ADJUNTO_MAX_MB') * 1024 * 1024, files: 1, fields: 0 },
      }),
    }),
  ],
  controllers: [
    PerfilesController,
    TrayectoriaController,
    DocumentosPracticanteController,
    TiposAtencionController,
    SupervisionController,
    EspecialidadesController,
    MensajeriaInternaController,
  ],
  providers: [EquipoService, SupervisionService, EspecialidadesService, MensajeriaInternaService, RegistroSisService],
})
export class EquipoModule {}
