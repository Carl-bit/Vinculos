'use client';

/**
 * Cobros (03b-4): etiquetas compartidas entre el portal y el backoffice, y
 * consultas del panel. La RLS decide que ve cada rol (ADMIN/GESTION todo;
 * PROFESIONAL lo suyo; PRACTICANTE nada).
 */
import { useQuery } from '@tanstack/react-query';

import type { TonoBadge } from '@/components/ui/Badge';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';
import { inicioDiaChile, sumarDias } from './panel';

export type EstadoPagoCitaVista = components['schemas']['EstadoPagoCitaVista'];
export type MedioPago = components['schemas']['MedioPago'];
export type LiquidacionVista = components['schemas']['LiquidacionVista'];

export const ESTADO_PAGO: Record<EstadoPagoCitaVista['estado_pago'], { texto: string; tono: TonoBadge }> = {
  PAGADO: { texto: 'Pagada', tono: 'positivo' },
  PARCIAL: { texto: 'Pago parcial', tono: 'atencion' },
  PENDIENTE: { texto: 'Pendiente', tono: 'atencion' },
  SIN_COBRO: { texto: 'Sin cobro', tono: 'neutro' },
};

export const MEDIO_PAGO: Record<MedioPago, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA_DEBITO: 'Tarjeta de débito',
  TARJETA_CREDITO: 'Tarjeta de crédito',
  CONVENIO: 'Convenio o bono',
};

export const ESTADO_LIQUIDACION: Record<LiquidacionVista['estado'], { texto: string; tono: TonoBadge }> = {
  BORRADOR: { texto: 'Borrador', tono: 'neutro' },
  EMITIDA: { texto: 'Emitida', tono: 'atencion' },
  PAGADA: { texto: 'Pagada', tono: 'positivo' },
};

export interface Periodo {
  tipo: 'semana' | 'mes';
  /** AAAA-MM-DD, inicio incluido. */
  desde: string;
  /** AAAA-MM-DD, fin excluido. */
  hasta: string;
}

/** Semana (lunes a domingo) o mes calendario de Chile, desplazado desde el actual. */
export function periodoChile(tipo: Periodo['tipo'], desplazamiento = 0): Periodo {
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  if (tipo === 'semana') {
    const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay();
    const lunes = sumarDias(hoy, -((dow + 6) % 7) + desplazamiento * 7);
    return { tipo, desde: lunes, hasta: sumarDias(lunes, 7) };
  }
  const [a, m] = hoy.split('-').map(Number) as [number, number];
  const inicio = new Date(Date.UTC(a, m - 1 + desplazamiento, 1));
  const fin = new Date(Date.UTC(a, m + desplazamiento, 1));
  return { tipo, desde: inicio.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) };
}

export function useReporteCobros(p: Periodo) {
  return useQuery({
    queryKey: ['panel', 'cobros', 'reporte', p.desde, p.hasta],
    queryFn: () => datos(api.GET('/api/cobros/reporte', { params: { query: { desde: p.desde, hasta: p.hasta } } })),
  });
}

/** Estado de pago de las citas del periodo (instantes de Chile). */
export function useEstadosCobro(p: Periodo, profesionalId?: string) {
  return useQuery({
    queryKey: ['panel', 'cobros', 'citas', p.desde, p.hasta, profesionalId ?? 'todos'],
    queryFn: () =>
      datos(
        api.GET('/api/cobros/citas', {
          params: { query: { desde: inicioDiaChile(p.desde).toISOString(), hasta: inicioDiaChile(p.hasta).toISOString(), profesionalId } },
        }),
      ),
  });
}

export function useDetalleCobro(citaId: string | null) {
  return useQuery({
    queryKey: ['panel', 'cobros', 'detalle', citaId],
    queryFn: () => datos(api.GET('/api/cobros/citas/{id}', { params: { path: { id: citaId! } } })),
    enabled: !!citaId,
  });
}

export function useLiquidaciones(profesionalId?: string) {
  return useQuery({
    queryKey: ['panel', 'cobros', 'liquidaciones', profesionalId ?? 'todos'],
    queryFn: () => datos(api.GET('/api/cobros/liquidaciones', { params: { query: { profesionalId } } })),
  });
}
