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
  /** Portal: 'principal' va en el header; 'secciones', en la fila de secciones de Mi cuenta. */
  grupo: 'principal' | 'modulos' | 'centro' | 'secciones';
  roles: readonly Rol[];
  /** Sin modulo = siempre visible para sus roles. */
  modulo?: ModuloCentro;
  /** Portal: se oculta en la cuenta restringida del adolescente (14-17, D-4); la API igual no lo entrega. */
  soloCuentaPlena?: boolean;
}

const EQUIPO: readonly Rol[] = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'];
const PORTAL: readonly Rol[] = ['PACIENTE', 'RESPONSABLE'];

export const MENU: Record<Zona, readonly ItemMenu[]> = {
  admin: [
    { etiqueta: 'Inicio', icono: 'space_dashboard', href: '/admin', grupo: 'principal', roles: EQUIPO },
    { etiqueta: 'Mi perfil', icono: 'account_circle', href: '/admin/perfil', grupo: 'principal', roles: EQUIPO },
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
    { etiqueta: 'Resumen', icono: 'person', href: '/portal', grupo: 'secciones', roles: PORTAL },
    { etiqueta: 'Pagos', icono: 'payments', href: '/portal/pagos', grupo: 'secciones', roles: PORTAL, modulo: 'COBROS', soloCuentaPlena: true },
    { etiqueta: 'Documentos', icono: 'description', href: '/portal/documentos', grupo: 'secciones', roles: PORTAL, modulo: 'FICHAS', soloCuentaPlena: true },
    {
      etiqueta: 'Consentimientos',
      icono: 'verified_user',
      href: '/portal/consentimientos',
      grupo: 'secciones',
      roles: PORTAL,
      modulo: 'FICHAS',
      soloCuentaPlena: true,
    },
    { etiqueta: 'Avisos', icono: 'notifications', href: '/portal/avisos', grupo: 'secciones', roles: PORTAL },
    { etiqueta: 'Lista de espera', icono: 'hourglass_empty', href: '/portal/lista-espera', grupo: 'secciones', roles: PORTAL, modulo: 'AGENDA' },
    { etiqueta: 'Reseñas', icono: 'rate_review', href: '/portal/resenas', grupo: 'secciones', roles: PORTAL, modulo: 'PAGINA_PUBLICA', soloCuentaPlena: true },
    { etiqueta: 'Seguridad', icono: 'lock', href: '/portal/seguridad', grupo: 'secciones', roles: PORTAL },
  ],
};

export function menuVisible(zona: Zona, rol: Rol, activos: readonly ModuloCentro[], opciones: { restringida?: boolean } = {}): ItemMenu[] {
  return MENU[zona].filter((i) => i.roles.includes(rol) && (!i.modulo || activos.includes(i.modulo)) && !(opciones.restringida && i.soloCuentaPlena));
}
