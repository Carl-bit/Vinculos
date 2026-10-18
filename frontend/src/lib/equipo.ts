'use client';

/**
 * Equipo (03b-4): cuentas, perfiles profesionales, practicantes, revisiones y
 * moderacion. La RLS y los guards deciden que ve cada rol; los nombres de
 * otros usuarios vienen del directorio o de /usuarios (solo ADMIN).
 */
import { useQuery } from '@tanstack/react-query';

import { api, datos } from './api/cliente';
import type { components } from './api/esquema';

export type Cuenta = components['schemas']['MiCuenta'];
export type PerfilProfesional = components['schemas']['PerfilProfesionalVista'];
export type TipoProfesional = components['schemas']['TipoAtencionProfesionalVista'];
export type EspecialidadDeclarada = components['schemas']['EspecialidadDeclaradaVista'];
export type Trayectoria = components['schemas']['TrayectoriaVista'];
export type Tarifa = components['schemas']['TarifaVista'];
export type EstadoRevision = components['schemas']['EstadoTipoSesion'];

const MINUTO = 60_000;

export const NOMBRE_ROL: Record<Cuenta['rol'], string> = {
  ADMIN: 'Cuenta madre',
  GESTION: 'Gestión',
  PROFESIONAL: 'Profesional',
  PRACTICANTE: 'Practicante',
  PACIENTE: 'Paciente',
  RESPONSABLE: 'Adulto responsable',
};

export const NOMBRE_MODALIDAD: Record<PerfilProfesional['modalidad'], string> = { PRESENCIAL: 'Presencial', ONLINE: 'Online', MIXTA: 'Presencial y online' };

export const ESTADO_REVISION: Record<EstadoRevision, { texto: string; tono: 'positivo' | 'atencion' | 'neutro' }> = {
  PROPUESTO: { texto: 'Por revisar', tono: 'atencion' },
  APROBADO: { texto: 'Aprobado', tono: 'positivo' },
  RECHAZADO: { texto: 'Rechazado', tono: 'neutro' },
};

export const TIPO_TRAYECTORIA: Record<Trayectoria['tipo'], string> = {
  TITULO: 'Título',
  POSTITULO: 'Postítulo',
  DIPLOMADO: 'Diplomado',
  MAGISTER: 'Magíster',
  DOCTORADO: 'Doctorado',
  OTRO: 'Otro',
};

/** Cuentas del equipo (sin pacientes ni adultos responsables). Solo ADMIN. */
export function useCuentasEquipo(habilitado: boolean) {
  return useQuery({
    queryKey: ['equipo', 'cuentas'],
    queryFn: () => datos(api.GET('/api/usuarios')),
    select: (l) => l.filter((u) => u.rol !== 'PACIENTE' && u.rol !== 'RESPONSABLE'),
    enabled: habilitado,
  });
}

/** El perfil puede no existir todavia (404): se trata como "sin perfil". */
export function usePerfilProfesional(id: string | undefined) {
  return useQuery({
    queryKey: ['equipo', 'perfil', id],
    queryFn: async () => {
      const r = await api.GET('/api/profesionales/{id}/perfil', { params: { path: { id: id! } } });
      return r.response.status === 404 ? null : datos(Promise.resolve(r));
    },
    enabled: !!id,
  });
}

export function useTiposDeProfesional(id: string | undefined) {
  return useQuery({
    queryKey: ['equipo', 'tipos', id],
    queryFn: () => datos(api.GET('/api/profesionales/{id}/tipos-atencion', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

export function useEspecialidades() {
  return useQuery({ queryKey: ['equipo', 'especialidades'], queryFn: () => datos(api.GET('/api/especialidades')), staleTime: 5 * MINUTO });
}

export function useEspecialidadesDe(id: string | undefined) {
  return useQuery({
    queryKey: ['equipo', 'especialidades', id],
    queryFn: () => datos(api.GET('/api/profesionales/{id}/especialidades', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

export function useTrayectoria(id: string | undefined) {
  return useQuery({
    queryKey: ['equipo', 'trayectoria', id],
    queryFn: () => datos(api.GET('/api/profesionales/{id}/trayectoria', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

export function useTarifas(id: string | undefined) {
  return useQuery({
    queryKey: ['equipo', 'tarifas', id],
    queryFn: () => datos(api.GET('/api/profesionales/{id}/tarifas', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

/** Datos privados descifrados: se piden solo al abrirlos (no quedan en pantalla por defecto). */
export function useDatosPrivados(id: string | undefined, habilitado: boolean) {
  return useQuery({
    queryKey: ['equipo', 'privados', id],
    queryFn: async () => {
      const r = await api.GET('/api/profesionales/{id}/datos-privados', { params: { path: { id: id! } } });
      return r.response.status === 404 ? null : datos(Promise.resolve(r));
    },
    enabled: !!id && habilitado,
    gcTime: 0,
  });
}

export function usePracticantes() {
  return useQuery({ queryKey: ['equipo', 'practicantes'], queryFn: () => datos(api.GET('/api/practicantes')) });
}

export function useSupervisiones() {
  return useQuery({ queryKey: ['equipo', 'supervisiones'], queryFn: () => datos(api.GET('/api/supervisiones')) });
}
