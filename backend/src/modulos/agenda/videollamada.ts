import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

export interface SalaVideollamada {
  url: string;
  expiraEn: Date;
}

/**
 * Proveedor de videollamada (Meet, Zoom, Jitsi...). La API solo conoce esta
 * interfaz; el proveedor real se elige al contratarlo. El enlace se guarda
 * cifrado (citas.enlace_online, CLINICO) y nunca va a logs.
 */
export abstract class ProveedorVideollamada {
  abstract crearSala(cita: { citaId: string; inicio: Date; fin: Date; expiraEn: Date }): Promise<SalaVideollamada>;
}

/** Implementacion simulada: URL no adivinable, sin llamar a ningun servicio externo. */
@Injectable()
export class ProveedorVideollamadaSimulado extends ProveedorVideollamada {
  async crearSala(cita: { citaId: string; expiraEn: Date }): Promise<SalaVideollamada> {
    return { url: `https://videollamada.simulada.local/sala/${randomBytes(16).toString('base64url')}`, expiraEn: cita.expiraEn };
  }
}
