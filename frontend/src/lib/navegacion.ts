/**
 * Menu por zona. Solo experiencia: oculta modulos no contratados y opciones
 * que el rol activo no tiene; la API responde 403 igual. Roles segun
 * docs/seguridad/matriz_permisos.md (se revisan en la fase de cada modulo).
 */
import type { components } from './api/esquema';
import type { Icono } from './iconos';
import type { Zona } from './roles';
import type { Rol } from './sesion';

export type ModuloCentro = components['schemas']['ModuloCentro'];

export interface ItemMenu {
  etiqueta: string;
  icono: Icono;
  href: string;
  grupo: 'principal' | 'modulos' | 'centro';
  roles: readonly Rol[];
  /** Sin modulo = siempre visible para sus roles. */
  modulo?: ModuloCentro;
}

const EQUIPO: readonly Rol[] = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'];
const PORTAL: readonly Rol[] = ['PACIENTE', 'RESPONSABLE'];

export const MENU: Record<Zona, readonly ItemMenu[]> = {
  admin: [
    { etiqueta: 'Inicio', icono: 'space_dashboard', href: '/admin', grupo: 'principal', roles: EQUIPO },
    { etiqueta: 'Fichas y Pacientes', icono: 'folder_shared', href: '/admin/fichas', grupo: 'modulos', roles: EQUIPO, modulo: 'FICHAS' },
    { etiqueta: 'Agenda y Espacios', icono: 'calendar_month', href: '/admin/agenda', grupo: 'modulos', roles: EQUIPO, modulo: 'AGENDA' },
    { etiqueta: 'Equipo', icono: 'groups', href: '/admin/equipo', grupo: 'modulos', roles: EQUIPO, modulo: 'EQUIPO' },
    { etiqueta: 'Match Terapéutico', icono: 'join', href: '/admin/match', grupo: 'modulos', roles: ['ADMIN'], modulo: 'MATCH' },
    { etiqueta: 'Cobros', icono: 'payments', href: '/admin/cobros', grupo: 'modulos', roles: ['ADMIN', 'GESTION', 'PROFESIONAL'], modulo: 'COBROS' },
    { etiqueta: 'Configuración', icono: 'settings', href: '/admin/configuracion', grupo: 'centro', roles: ['ADMIN'] },
    { etiqueta: 'Página pública', icono: 'public', href: '/', grupo: 'centro', roles: EQUIPO, modulo: 'PAGINA_PUBLICA' },
  ],
  portal: [
    { etiqueta: 'Mi cuenta', icono: 'person', href: '/portal', grupo: 'principal', roles: PORTAL },
    { etiqueta: 'Pedir una hora', icono: 'event', href: '/portal/pedir-hora', grupo: 'principal', roles: PORTAL, modulo: 'AGENDA' },
  ],
};

export function menuVisible(zona: Zona, rol: Rol, activos: readonly ModuloCentro[]): ItemMenu[] {
  return MENU[zona].filter((i) => i.roles.includes(rol) && (!i.modulo || activos.includes(i.modulo)));
}
