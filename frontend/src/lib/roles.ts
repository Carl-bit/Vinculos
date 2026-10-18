import type { Rol } from './sesion';

/** Nombre visible de cada rol. "Cuenta madre" es ADMIN (brechas C-2). */
export const NOMBRE_ROL: Record<Rol, string> = {
  ADMIN: 'Cuenta madre',
  GESTION: 'Gestión',
  PROFESIONAL: 'Profesional',
  PRACTICANTE: 'Practicante',
  PACIENTE: 'Paciente',
  RESPONSABLE: 'Adulto responsable',
};

export type Zona = 'admin' | 'portal';

const ZONA: Record<Rol, Zona> = {
  ADMIN: 'admin',
  GESTION: 'admin',
  PROFESIONAL: 'admin',
  PRACTICANTE: 'admin',
  PACIENTE: 'portal',
  RESPONSABLE: 'portal',
};

export const zonaDeRol = (rol: Rol): Zona => ZONA[rol];
export const inicioDeRol = (rol: Rol): string => `/${ZONA[rol]}`;

/** Roles que operan como administracion del centro (selector de equipo). */
export const esAdministracion = (rol: Rol): boolean => rol === 'ADMIN' || rol === 'GESTION';

/** Destino tras entrar: la ruta pedida si es de la zona del rol (nunca una URL externa en ?volver), si no el inicio del rol. */
export const destinoTrasIngreso = (rol: Rol, volver: string | null | undefined): string =>
  volver && (volver === `/${ZONA[rol]}` || volver.startsWith(`/${ZONA[rol]}/`)) ? volver : inicioDeRol(rol);
