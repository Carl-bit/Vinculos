import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';

export interface SolicitudCobro {
  /** Id del intento (cobros_pasarela.id): viaja a la pasarela y vuelve en el webhook. */
  referencia: string;
  /** CLP. */
  monto: number;
  /** A donde vuelve el paciente despues de pagar. */
  retorno: string;
}

export interface EventoPasarela {
  /** Id unico del evento (idempotencia del webhook). */
  eventoId: string;
  referencia: string;
  pagado: boolean;
}

/**
 * Pasarela de pago (docs/api/integraciones.md, 03b-3.1). Los modulos solo
 * conocen esta interfaz; CoreModule elige la implementacion por configuracion
 * (PASARELA_PROVEEDOR). El adaptador real se elige y configura por centro,
 * segun su convenio (proveedor y comisiones); hoy solo existe la simulada.
 */
export abstract class ProveedorPasarela {
  /** false = sin convenio: el centro no puede habilitar el medio PASARELA. */
  abstract readonly disponible: boolean;
  /** true = modo demostracion (no se cobra). La UI lo indica. */
  abstract readonly simulada: boolean;
  /** Crea el cobro en la pasarela y devuelve la URL donde paga el paciente. */
  abstract crearCobro(solicitud: SolicitudCobro): Promise<{ urlPago: string }>;
  /** Verifica la firma del webhook y lo traduce. Firma invalida: 401. */
  abstract verificarWebhook(cuerpo: unknown, firma: string | undefined): EventoPasarela;
}

/** Sin convenio (produccion sin adaptador): el medio PASARELA no se puede habilitar. */
@Injectable()
export class PasarelaNoConfigurada extends ProveedorPasarela {
  readonly disponible = false;
  readonly simulada = false;

  async crearCobro(): Promise<{ urlPago: string }> {
    throw new UnprocessableEntityException({ message: 'El centro no tiene una pasarela de pago configurada', restriccion: 'pasarela_sin_convenio' });
  }

  verificarWebhook(): EventoPasarela {
    throw new UnauthorizedException('Pasarela no configurada');
  }
}

/**
 * Simulada (centro de demostracion y tests): no cobra. La "pagina de pago" es
 * una pantalla del front que llama a POST /api/publico/pasarela/simulada; la API
 * arma el mismo evento firmado (HMAC-SHA256) que mandaria una pasarela real y
 * lo procesa por el camino del webhook. La API no arranca con esta
 * implementacion en produccion (core/config/entorno.ts).
 */
export class PasarelaSimulada extends ProveedorPasarela {
  readonly disponible = true;
  readonly simulada = true;

  constructor(
    private readonly secreto: string,
    private readonly frontendUrl: string,
  ) {
    super();
  }

  async crearCobro(s: SolicitudCobro): Promise<{ urlPago: string }> {
    const q = new URLSearchParams({ ref: s.referencia, monto: String(s.monto), volver: s.retorno });
    return { urlPago: `${this.frontendUrl.replace(/\/+$/, '')}/pago-simulado?${q.toString()}` };
  }

  /** Evento firmado como lo mandaria la pasarela (solo modo demostracion). */
  simular(referencia: string, pagado: boolean): { cuerpo: EventoPasarela; firma: string } {
    const cuerpo: EventoPasarela = { eventoId: randomUUID(), referencia, pagado };
    return { cuerpo, firma: this.firmar(cuerpo) };
  }

  verificarWebhook(cuerpo: unknown, firma: string | undefined): EventoPasarela {
    const esperada = Buffer.from(this.firmar(cuerpo));
    const recibida = Buffer.from(firma ?? '');
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) {
      throw new UnauthorizedException('Firma del webhook invalida');
    }
    const e = cuerpo as Partial<EventoPasarela>;
    if (typeof e.eventoId !== 'string' || typeof e.referencia !== 'string' || typeof e.pagado !== 'boolean') {
      throw new UnauthorizedException('Evento de pasarela invalido');
    }
    return { eventoId: e.eventoId, referencia: e.referencia, pagado: e.pagado };
  }

  // ponytail: firma sobre JSON.stringify del cuerpo ya parseado (sirve para la
  // simulada, que firma ella misma); un adaptador real firma el cuerpo crudo (rawBody de Nest).
  private firmar(cuerpo: unknown): string {
    return createHmac('sha256', this.secreto).update(JSON.stringify(cuerpo)).digest('hex');
  }
}
