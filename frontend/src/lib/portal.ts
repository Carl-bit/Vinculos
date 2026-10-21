'use client';

/**
 * Consultas del portal del paciente (03b-3). Todas pasan por la RLS de la
 * API: el paciente ve lo suyo; el adulto responsable, lo de sus menores
 * (indicando `pacienteId`); el adolescente (14-17) tiene cuenta restringida
 * y la API le devuelve vacio lo que no le corresponde. El front solo decide
 * que mostrar, nunca que se puede.
 */
import { useQuery } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';

export type CitaPortal = components['schemas']['CitaPortal'];
export type PersonaPortal = components['schemas']['PersonaPortal'];
export type PacientePortal = components['schemas']['PacientePortal'];
export type MisDatosPortal = components['schemas']['MisDatosPortal'];
export type MensajePortal = components['schemas']['MensajePortal'];
export type ResenaPortal = components['schemas']['ResenaPortal'];
export type EstadoPagoCita = components['schemas']['EstadoPagoCitaVista'];
export type DocumentoClinico = components['schemas']['DocumentoClinicoVista'];
export type SolicitudEpicrisis = components['schemas']['SolicitudEpicrisisPortal'];
export type Consentimiento = components['schemas']['ConsentimientoVista'];
export type AvisoConsentimiento = components['schemas']['AvisoConsentimientoVista'];
export type MensajeBandeja = components['schemas']['MensajeBandeja'];
export type Preferencias = components['schemas']['Preferencias'];

const MINUTO = 60_000;

export const clavesPortal = {
  todo: ['portal'] as const,
  citas: (pacienteId?: string, todas?: boolean) => ['portal', 'citas', pacienteId ?? 'propio', todas ? 'todas' : 'proximas'] as const,
  misDatos: (pacienteId?: string) => ['portal', 'mis-datos', pacienteId ?? 'propio'] as const,
  preferencias: (pacienteId?: string) => ['portal', 'preferencias', pacienteId ?? 'propio'] as const,
};

export function usePacientesPortal() {
  return useQuery({ queryKey: ['portal', 'pacientes'], queryFn: () => datos(api.GET('/api/portal/pacientes')), staleTime: 5 * MINUTO });
}

/** Equipo tratante (tratante actual y profesionales de sus citas): solo id y nombre. */
export function useEquipoPortal() {
  return useQuery({ queryKey: ['portal', 'equipo'], queryFn: () => datos(api.GET('/api/portal/equipo')), staleTime: 5 * MINUTO });
}

/** Quien supervisa a los practicantes de sus consentimientos (03b-3). */
export function useSupervisoresPortal(habilitado = true) {
  return useQuery({
    queryKey: ['portal', 'supervisores'],
    queryFn: () => datos(api.GET('/api/portal/supervisores')),
    staleTime: 5 * MINUTO,
    enabled: habilitado,
  });
}

/** id -> nombre de las personas del equipo que la cuenta puede ver. */
export function nombresDe(...listas: (PersonaPortal[] | undefined)[]): Map<string, string> {
  return new Map(listas.flatMap((l) => l ?? []).map((p) => [p.id, p.nombre ?? 'Profesional del centro']));
}

export function useCitasPortal(pacienteId: string | undefined, todas: boolean, habilitado = true) {
  return useQuery({
    queryKey: clavesPortal.citas(pacienteId, todas),
    queryFn: () => datos(api.GET('/api/portal/citas', { params: { query: { pacienteId, todas } } })),
    enabled: habilitado,
  });
}

export function useMisDatos(pacienteId: string | undefined, habilitado = true) {
  return useQuery({
    queryKey: clavesPortal.misDatos(pacienteId),
    queryFn: () => datos(api.GET('/api/portal/mis-datos', { params: { query: { pacienteId } } })),
    enabled: habilitado,
  });
}

export function useMensajesPortal() {
  return useQuery({ queryKey: ['portal', 'mensajes'], queryFn: () => datos(api.GET('/api/mensajes')) });
}

export function useResenasPortal() {
  return useQuery({ queryKey: ['portal', 'resenas'], queryFn: () => datos(api.GET('/api/portal/resenas')) });
}

export function useEpicrisisPortal(habilitado = true) {
  return useQuery({ queryKey: ['portal', 'epicrisis'], queryFn: () => datos(api.GET('/api/epicrisis')), enabled: habilitado });
}

export function useDocumentosPortal(pacienteId: string | undefined, habilitado = true) {
  return useQuery({
    queryKey: ['portal', 'documentos', pacienteId ?? 'propio'],
    queryFn: () => datos(api.GET('/api/documentos-clinicos', { params: { query: { pacienteId } } })),
    enabled: habilitado,
  });
}

export function useConsentimientosPortal(habilitado = true) {
  return useQuery({ queryKey: ['portal', 'consentimientos'], queryFn: () => datos(api.GET('/api/consentimientos')), enabled: habilitado });
}

export function useAvisosConsentimientoPortal(habilitado = true) {
  return useQuery({ queryKey: ['portal', 'avisos-consentimiento'], queryFn: () => datos(api.GET('/api/avisos-consentimiento')), enabled: habilitado });
}

export function useBandeja() {
  return useQuery({ queryKey: ['portal', 'bandeja'], queryFn: () => datos(api.GET('/api/notificaciones/bandeja')), refetchInterval: 2 * MINUTO });
}

/** Paciente: las propias. Adulto responsable: las de cada menor a su cargo (le llegan a el). */
export function usePreferencias(pacienteId: string | undefined, responsable: boolean, habilitado = true) {
  return useQuery({
    queryKey: clavesPortal.preferencias(pacienteId),
    queryFn: () =>
      responsable
        ? datos(api.GET('/api/notificaciones/preferencias/pacientes/{pacienteId}', { params: { path: { pacienteId: pacienteId! } } }))
        : datos(api.GET('/api/notificaciones/preferencias')),
    enabled: habilitado && (!responsable || !!pacienteId),
  });
}

export function useCobrosPortal(habilitado = true) {
  return useQuery({ queryKey: ['portal', 'cobros'], queryFn: () => datos(api.GET('/api/cobros/citas')), enabled: habilitado });
}

/** Estado de una cita para el paciente (diseño "Mi Cuenta"). 03b-3.2: se confirma con el pago (sin aprobacion aparte). */
export function estadoCitaPortal(c: Pick<CitaPortal, 'estado' | 'realizada' | 'fin'>): { texto: string; tono: 'positivo' | 'atencion' | 'neutro' } {
  if (c.estado === 'CANCELADA') return { texto: 'Cancelada', tono: 'atencion' };
  if (c.estado === 'POR_REPROGRAMAR') return { texto: 'Por reprogramar', tono: 'atencion' };
  if (c.estado === 'PENDIENTE_PAGO') return { texto: 'Pago pendiente', tono: 'atencion' };
  if (c.estado === 'LIBERADA') return { texto: 'Liberada (pago vencido)', tono: 'neutro' };
  if (c.realizada) return { texto: 'Completada', tono: 'neutro' };
  return { texto: 'Confirmada', tono: 'positivo' };
}
