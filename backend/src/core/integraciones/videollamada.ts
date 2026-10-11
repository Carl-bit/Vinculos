import { randomBytes } from 'node:crypto';

import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { ModoVideollamada } from '@prisma/client';

export interface SalaVideollamada {
  url: string;
  expiraEn: Date;
}

export interface SolicitudSala {
  citaId: string;
  inicio: Date;
  fin: Date;
  expiraEn: Date;
  /** Configuracion del profesional (salas_videollamada); sin fila = ENLACE_PROPIO sin enlace. */
  modo: ModoVideollamada;
  enlacePropio: string | null;
}

/**
 * Videollamada (docs/api/integraciones.md). Los modulos solo conocen esta
 * interfaz; CoreModule elige la implementacion por configuracion. El enlace se
 * guarda cifrado (citas.enlace_online, CLINICO) y nunca va a logs.
 */
export abstract class ProveedorVideollamada {
  abstract crearSala(solicitud: SolicitudSala): Promise<SalaVideollamada>;
}

/** Simulada (default en tests): URL no adivinable, sin servicios externos. */
@Injectable()
export class ProveedorVideollamadaSimulado extends ProveedorVideollamada {
  async crearSala(s: SolicitudSala): Promise<SalaVideollamada> {
    return { url: `https://videollamada.simulada.local/sala/${randomBytes(16).toString('base64url')}`, expiraEn: s.expiraEn };
  }
}

/**
 * Modo por profesional:
 * - ENLACE_PROPIO (default): su sala fija (guardada cifrada en su perfil).
 * - JITSI: sala unica por cita con nombre no adivinable (128 bits), bajo una
 *   URL base configurable. Desactivado por defecto (JITSI_HABILITADO).
 */
export class ProveedorVideollamadaPorProfesional extends ProveedorVideollamada {
  constructor(
    private readonly jitsiHabilitado: boolean,
    private readonly jitsiUrlBase: string,
  ) {
    super();
  }

  async crearSala(s: SolicitudSala): Promise<SalaVideollamada> {
    if (s.modo === 'JITSI') {
      if (!this.jitsiHabilitado) {
        throw new UnprocessableEntityException({ message: 'Jitsi no esta habilitado en la plataforma', restriccion: 'videollamada_jitsi_deshabilitado' });
      }
      return { url: `${this.jitsiUrlBase.replace(/\/+$/, '')}/vinculos-${randomBytes(16).toString('hex')}`, expiraEn: s.expiraEn };
    }
    if (!s.enlacePropio) {
      throw new UnprocessableEntityException({
        message: 'El profesional no tiene configurado el enlace de su sala de videollamada',
        restriccion: 'videollamada_sin_sala',
      });
    }
    return { url: s.enlacePropio, expiraEn: s.expiraEn };
  }
}
