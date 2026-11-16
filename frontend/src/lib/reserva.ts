/**
 * Estado de una reserva sin cuenta (pedir hora desde el sitio): la hora
 * queda RETENIDA hasta verificar el correo, luego SOLICITADA hasta que la
 * apruebe su profesional (o proponga otras horas). El token de la reserva vive solo en memoria de la pestana,
 * nunca en storage ni en la URL.
 */
import { useQuery } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';

export type EstadoReserva = components['schemas']['EstadoReserva'];

/** Estados en que ya no hay nada que esperar: el sondeo se detiene. */
const FINALES: ReadonlySet<EstadoReserva['estado']> = new Set(['CONFIRMADA', 'LIBERADA', 'CANCELADA', 'POR_REPROGRAMAR']);
export const esFinal = (e: EstadoReserva | undefined) => !!e && FINALES.has(e.estado);

/** Cada cuanto se consulta el estado mientras la pestana esta visible. */
export const SONDEO_MS = 4000;

/**
 * Estado de la reserva, consultado cada SONDEO_MS mientras la pestana esta
 * visible (React Query pausa el intervalo en segundo plano) y hasta llegar a
 * un estado final. Asi la pestana avanza sola aunque el correo se verifique en
 * otro dispositivo. El vencimiento lo decide el servidor.
 */
export function useEstadoReserva(reserva: string | null) {
  return useQuery({
    queryKey: ['reserva', reserva],
    queryFn: () => datos(api.POST('/api/publico/reservas/estado', { body: { reserva: reserva! } })),
    enabled: !!reserva,
    refetchInterval: (q) => (esFinal(q.state.data) ? false : SONDEO_MS),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
