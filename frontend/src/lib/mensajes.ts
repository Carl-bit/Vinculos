'use client';

/**
 * Mensajes del panel (03b-5.2): hilos internos del equipo (polling: sin
 * websockets, CLAUDE.md), mensajes que escriben los pacientes desde el portal
 * (se responden por un canal externo: no hay respuesta in-app) y la bandeja
 * de avisos propios.
 */
import { useQuery } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';

export type Hilo = components['schemas']['HiloConNoLeidos'];
export type MensajesHilo = components['schemas']['MensajesHilo'];
export type MensajePaciente = components['schemas']['MensajePortal'];
export type AvisoBandeja = components['schemas']['MensajeBandeja'];

const SEGUNDO = 1000;

export function useHilos(pacienteId?: string) {
  return useQuery({
    queryKey: ['hilos', pacienteId ?? 'todos'],
    queryFn: () => datos(api.GET('/api/hilos', { params: { query: pacienteId ? { pacienteId } : {} } })),
    refetchInterval: 30 * SEGUNDO,
  });
}

/** Mensajes de un hilo: abrirlo registra la lectura propia (por eso se refresca la lista de hilos). */
export function useMensajesHilo(id: string | null) {
  return useQuery({
    queryKey: ['hilos', 'mensajes', id],
    queryFn: () => datos(api.GET('/api/hilos/{id}/mensajes', { params: { path: { id: id! } } })),
    enabled: !!id,
    refetchInterval: 15 * SEGUNDO,
  });
}

export function useMensajesPacientes(habilitado: boolean) {
  return useQuery({ queryKey: ['mensajes-pacientes'], queryFn: () => datos(api.GET('/api/mensajes')), enabled: habilitado, refetchInterval: 60 * SEGUNDO });
}

export function useBandejaAvisos() {
  return useQuery({ queryKey: ['notificaciones', 'bandeja'], queryFn: () => datos(api.GET('/api/notificaciones/bandeja')), refetchInterval: 2 * 60 * SEGUNDO });
}

/** El autor retira un mensaje dentro de 5 minutos (la BD lo exige; esto solo decide si se ofrece). */
export const MINUTOS_RETIRO = 5;
export const retirable = (creadoEn: string, ahora = Date.now()) => ahora - new Date(creadoEn).getTime() < MINUTOS_RETIRO * 60 * SEGUNDO;
