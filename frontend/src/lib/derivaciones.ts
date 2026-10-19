'use client';

/**
 * Acceso a fichas ajenas (03b-5.2): accesos clinicos temporales, derivaciones
 * (con la bandeja de ADMIN y supervisores y las ofertas del candidato) y
 * consentimientos de atencion con practicante. Toda escritura pasa por
 * funciones de la BD; la RLS decide que ve cada rol.
 */
import { useQueries, useQuery } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';
import { ApiError } from './api/errores';

export type Derivacion = components['schemas']['DerivacionVista'];
export type EstadoDerivacion = components['schemas']['EstadoDerivacion'];
export type EstadoCandidato = components['schemas']['EstadoCandidato'];
export type DerivacionPendiente = components['schemas']['DerivacionPendiente'];
export type OfertaDerivacion = components['schemas']['OfertaDerivacion'];
export type AccesoTemporal = components['schemas']['AccesoTemporalVista'];
export type ConsentimientoEquipo = components['schemas']['ConsentimientoVista'];
export type AvisoConsentimientoEquipo = components['schemas']['AvisoConsentimientoVista'];

type Tono = 'positivo' | 'atencion' | 'neutro';

export const ESTADO_DERIVACION: Record<EstadoDerivacion, { texto: string; tono: Tono }> = {
  PENDIENTE: { texto: 'En curso', tono: 'atencion' },
  ESPERANDO_CONSENTIMIENTO: { texto: 'Esperando consentimiento', tono: 'atencion' },
  ACEPTADA: { texto: 'Aceptada', tono: 'positivo' },
  SIN_ASIGNAR: { texto: 'Sin asignar', tono: 'atencion' },
  CANCELADA: { texto: 'Cancelada', tono: 'neutro' },
  CERRADA: { texto: 'Cerrada', tono: 'neutro' },
};

export const ESTADO_CANDIDATO: Record<EstadoCandidato, string> = {
  EN_ESPERA: 'En espera',
  OFRECIDA: 'Oferta abierta',
  ACEPTADA: 'Aceptó',
  RECHAZADA: 'Rechazó',
  EXPIRADA: 'No respondió a tiempo',
  OMITIDA: 'Omitido',
  RECHAZADO_POR_PACIENTE: 'El paciente no consintió',
};

export const ESTADO_CONSENTIMIENTO: Record<ConsentimientoEquipo['estado'], { texto: string; tono: Tono }> = {
  SOLICITADO: { texto: 'Por responder', tono: 'atencion' },
  ACEPTADO: { texto: 'Aceptado', tono: 'positivo' },
  RECHAZADO: { texto: 'Rechazado', tono: 'neutro' },
  VENCIDO: { texto: 'Vencido', tono: 'neutro' },
  REVOCADO: { texto: 'Retirado', tono: 'neutro' },
};

export const MOTIVO_ACCESO: Record<AccesoTemporal['motivo'], string> = { REEMPLAZO: 'Reemplazo', INTERCONSULTA: 'Interconsulta' };
export const ALCANCE_ACCESO: Record<AccesoTemporal['alcance'], string> = { LECTURA: 'Solo lectura', LECTURA_ESCRITURA: 'Lectura y escritura' };

/** Vigente: ya empezo y aun no vence (el acceso se corta solo al vencer). */
export const accesoVigente = (a: AccesoTemporal, ahora = Date.now()) => new Date(a.desde).getTime() <= ahora && new Date(a.hasta).getTime() > ahora;

export function useDerivacionesLista(estado?: EstadoDerivacion, habilitado = true) {
  return useQuery({
    queryKey: ['panel', 'derivaciones', estado ?? 'todas'],
    queryFn: () => datos(api.GET('/api/derivaciones', { params: { query: estado ? { estado } : {} } })),
    enabled: habilitado,
  });
}

/** Bandeja de ADMIN y supervisores vigentes (403 para el resto: no se muestra). */
export function usePendientesDerivacion(habilitado: boolean) {
  return useQuery({
    queryKey: ['panel', 'derivaciones', 'pendientes'],
    queryFn: () => datos(api.GET('/api/derivaciones/pendientes')),
    enabled: habilitado,
    retry: false,
  });
}

/**
 * Ofertas abiertas para el candidato. No hay un listado propio: la BD avisa
 * cada oferta (DERIVACION_OFRECIDA, referencia = derivacion) y aca se consulta
 * cada una; la que ya no esta ofrecida a este usuario responde 404 y se omite
 * (no revela si paso a otro).
 */
export function useOfertasDerivacion(habilitado: boolean) {
  const avisos = useQuery({
    queryKey: ['notificaciones', 'registro'],
    queryFn: () => datos(api.GET('/api/notificaciones')),
    enabled: habilitado,
    refetchInterval: 2 * 60_000,
  });
  const ids = [...new Set((avisos.data ?? []).filter((n) => n.tipo === 'DERIVACION_OFRECIDA').map((n) => n.referenciaId))];
  const ofertas = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['panel', 'oferta', id],
      queryFn: () => datos(api.GET('/api/derivaciones/{id}/oferta', { params: { path: { id } } })),
      retry: false,
    })),
  });
  const lista = ofertas.flatMap((o) => (o.data ? [o.data] : []));
  const fallas = ofertas.filter((o) => o.error && !(o.error instanceof ApiError && o.error.status === 404));
  return {
    isPending: avisos.isPending || ofertas.some((o) => o.isPending),
    error: avisos.error ?? fallas[0]?.error ?? null,
    data: avisos.data ? lista.sort((a, b) => a.venceEn.localeCompare(b.venceEn)) : undefined,
    refetch: () => void avisos.refetch(),
  };
}

export function useAccesosRecibidos(habilitado: boolean) {
  return useQuery({ queryKey: ['panel', 'accesos-temporales', 'todos'], queryFn: () => datos(api.GET('/api/accesos-temporales')), enabled: habilitado });
}

export function useConsentimientosEquipo(habilitado: boolean) {
  return useQuery({ queryKey: ['panel', 'consentimientos'], queryFn: () => datos(api.GET('/api/consentimientos')), enabled: habilitado });
}

export function useAvisosConsentimientoEquipo(habilitado: boolean) {
  return useQuery({ queryKey: ['panel', 'avisos-consentimiento'], queryFn: () => datos(api.GET('/api/avisos-consentimiento')), enabled: habilitado });
}

/** Version vigente del consentimiento de practicante (la BD exige esta al aceptar). */
export function usePoliticaPracticante() {
  return useQuery({
    queryKey: ['publico', 'politica', 'CONSENTIMIENTO_PRACTICANTE'],
    queryFn: () => datos(api.GET('/api/publico/politicas/{tipo}', { params: { path: { tipo: 'CONSENTIMIENTO_PRACTICANTE' } } })),
    retry: false,
  });
}
