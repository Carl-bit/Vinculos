/**
 * 03b-3.1: confirmacion de la cita por medio de pago. Caminos con las
 * mismas acciones: la reserva sin cuenta (token opaco en memoria de la
 * pestaña, nunca en storage ni en la URL), el enlace de pago del correo
 * (03b-3.4) y la cuenta del paciente.
 */
import { useQuery } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';
import { subirArchivo } from './subidas';

export type EstadoConfirmacion = components['schemas']['EstadoConfirmacion'];
export type MedioConfirmacion = components['schemas']['MedioConfirmacion'];
export type DatosTransferencia = components['schemas']['DatosTransferencia'];
export type CobroIniciado = components['schemas']['CobroIniciado'];

/** Estados en que ya no hay nada que esperar: el sondeo se detiene. */
const FINALES: ReadonlySet<EstadoConfirmacion['estado']> = new Set(['CONFIRMADA', 'LIBERADA', 'CANCELADA', 'POR_REPROGRAMAR']);
export const esFinal = (e: EstadoConfirmacion | undefined) => !!e && FINALES.has(e.estado);

/** Cada cuanto se consulta el estado mientras la pestaña esta visible. */
export const SONDEO_MS = 4000;

export interface CaminoPago {
  clave: readonly unknown[];
  /** 03b-3.2: reserva sin cuenta (pago en el centro = enlace al correo; aun no hay paciente). */
  sinCuenta: boolean;
  estado: () => Promise<EstadoConfirmacion>;
  elegir: (medio: MedioConfirmacion) => Promise<EstadoConfirmacion>;
  transferencia: () => Promise<DatosTransferencia>;
  comprobante: (archivo: File) => Promise<EstadoConfirmacion>;
  pasarela: () => Promise<CobroIniciado>;
}

export function caminoReserva(reserva: string): CaminoPago {
  return {
    clave: ['reserva', reserva],
    sinCuenta: true,
    estado: () => datos(api.POST('/api/publico/reservas/estado', { body: { reserva } })),
    elegir: (medio) => datos(api.POST('/api/publico/reservas/medio', { body: { reserva, medio } })),
    transferencia: () => datos(api.POST('/api/publico/reservas/transferencia', { body: { reserva } })),
    comprobante: (archivo) => subirArchivo<EstadoConfirmacion>('/api/publico/reservas/comprobante', 'archivo', archivo, { reserva }),
    pasarela: () => datos(api.POST('/api/publico/reservas/pasarela', { body: { reserva } })),
  };
}

/**
 * 03b-3.4: enlace de pago del correo (quien no tiene cuenta): el token va en
 * el cuerpo de cada llamada. El paciente ya existe: pagar en el centro
 * confirma directo (no es la reserva sin cuenta).
 */
export function caminoEnlace(enlace: string): CaminoPago {
  return {
    clave: ['enlace', enlace],
    sinCuenta: false,
    estado: () => datos(api.POST('/api/publico/pagos/estado', { body: { enlace } })),
    elegir: (medio) => datos(api.POST('/api/publico/pagos/medio', { body: { enlace, medio } })),
    transferencia: () => datos(api.POST('/api/publico/pagos/transferencia', { body: { enlace } })),
    comprobante: (archivo) => subirArchivo<EstadoConfirmacion>('/api/publico/pagos/comprobante', 'archivo', archivo, { enlace }),
    pasarela: () => datos(api.POST('/api/publico/pagos/pasarela', { body: { enlace } })),
  };
}

export function caminoPortal(citaId: string): CaminoPago {
  const path = { id: citaId };
  return {
    clave: ['portal', 'pago', citaId],
    sinCuenta: false,
    estado: () => datos(api.GET('/api/portal/citas/{id}/pago', { params: { path } })),
    elegir: (medio) => datos(api.POST('/api/portal/citas/{id}/medio', { params: { path }, body: { medio } })),
    transferencia: () => datos(api.GET('/api/portal/citas/{id}/transferencia', { params: { path } })),
    comprobante: (archivo) => subirArchivo<EstadoConfirmacion>(`/api/portal/citas/${citaId}/comprobante`, 'archivo', archivo),
    pasarela: () => datos(api.POST('/api/portal/citas/{id}/pasarela', { params: { path } })),
  };
}

/**
 * Estado de la reserva o de la cita, consultado cada SONDEO_MS mientras la
 * pestaña esta visible (React Query pausa el intervalo en segundo plano) y
 * hasta llegar a un estado final. Asi la pestaña avanza sola aunque el correo
 * se verifique en otro dispositivo. El vencimiento lo decide el servidor.
 */
export function useEstadoPago(camino: CaminoPago | null) {
  return useQuery({
    queryKey: ['pago', ...(camino?.clave ?? [])],
    queryFn: () => camino!.estado(),
    enabled: !!camino,
    refetchInterval: (q) => (esFinal(q.state.data) ? false : SONDEO_MS),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** Textos del paso de pago (sin montos: los pone la pantalla). */
export const MEDIOS: Record<MedioConfirmacion, { titulo: string; detalle: string }> = {
  PAGO_EN_CENTRO: { titulo: 'Pago en el centro', detalle: 'La hora queda confirmada ahora. Pagas al llegar a tu sesión.' },
  TRANSFERENCIA: { titulo: 'Transferencia', detalle: 'Te mostramos los datos de la cuenta. La hora se confirma cuando validamos la transferencia.' },
  PASARELA: { titulo: 'Pago en línea', detalle: 'Pagas con tarjeta y la hora se confirma al instante.' },
};
