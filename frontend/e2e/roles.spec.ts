import { expect, test, type Page } from '@playwright/test';

import { ingresar } from './apoyo';

/**
 * 03b-4.1 (6.2): verificacion de roles con los usuarios demo
 * (docs/pruebas/verificacion_roles.md). Por usuario: el menu muestra solo lo
 * que corresponde segun la matriz, entrar por URL a una ruta no permitida
 * muestra "sin permiso" y la API responde 403 a una accion no permitida.
 * El access token se toma de la respuesta del puente /sesion (el mismo que
 * usa la pestaña), sin logins extra.
 */
const SIN_PERMISO = 'No tienes acceso a esta sección con el rol activo';
const SOLO_RESPONSABLE = 'Esta sección la ve tu adulto responsable';

interface Caso {
  nombre: string;
  usuario: string;
  zona: 'admin' | 'portal';
  /** Cambiar a este rol despues de entrar (cuentas con dos roles). */
  rol?: 'PROFESIONAL';
  menu: string[];
  bloqueadas: { ruta: string; texto: string }[];
  api: { metodo: 'GET' | 'PATCH' | 'POST'; ruta: string; cuerpo?: object };
}

const MENU_ADMIN = [
  'Inicio',
  'Mi perfil',
  'Mensajes',
  'Fichas y Pacientes',
  'Agenda y Espacios',
  'Equipo',
  'Match Terapéutico',
  'Cobros',
  'Configuración',
  'Página pública',
];
const MENU_CLINICO = ['Inicio', 'Mi perfil', 'Mensajes', 'Fichas y Pacientes', 'Agenda y Espacios', 'Equipo', 'Cobros', 'Página pública'];
const SECCIONES = ['Resumen', 'Pagos', 'Documentos', 'Consentimientos', 'Avisos', 'Reseñas', 'Seguridad'];

const CASOS: Caso[] = [
  {
    nombre: 'ADMIN',
    usuario: 'admin',
    zona: 'admin',
    menu: MENU_ADMIN,
    bloqueadas: [],
    api: { metodo: 'GET', ruta: '/api/portal/citas' },
  },
  {
    nombre: 'ADMIN + PROFESIONAL (rol activo PROFESIONAL)',
    usuario: 'directora',
    zona: 'admin',
    rol: 'PROFESIONAL',
    menu: MENU_CLINICO,
    bloqueadas: [
      { ruta: '/admin/configuracion', texto: SIN_PERMISO },
      { ruta: '/admin/match', texto: SIN_PERMISO },
    ],
    api: { metodo: 'GET', ruta: '/api/usuarios' },
  },
  {
    nombre: 'GESTION',
    usuario: 'gestion',
    zona: 'admin',
    menu: MENU_CLINICO,
    bloqueadas: [
      { ruta: '/admin/configuracion', texto: SIN_PERMISO },
      { ruta: '/admin/match', texto: SIN_PERMISO },
    ],
    api: { metodo: 'PATCH', ruta: '/api/configuracion', cuerpo: { nombreCentro: 'No' } },
  },
  {
    nombre: 'PROFESIONAL',
    usuario: 'profesional1',
    zona: 'admin',
    menu: MENU_CLINICO,
    bloqueadas: [
      { ruta: '/admin/configuracion', texto: SIN_PERMISO },
      { ruta: '/admin/match', texto: SIN_PERMISO },
    ],
    api: { metodo: 'GET', ruta: '/api/usuarios' },
  },
  {
    nombre: 'PRACTICANTE',
    usuario: 'practicante',
    zona: 'admin',
    menu: MENU_CLINICO.filter((m) => m !== 'Cobros'),
    bloqueadas: [
      { ruta: '/admin/cobros', texto: SIN_PERMISO },
      { ruta: '/admin/configuracion', texto: SIN_PERMISO },
    ],
    api: { metodo: 'GET', ruta: '/api/cobros/liquidaciones' },
  },
  {
    nombre: 'PACIENTE adulto',
    usuario: 'paciente',
    zona: 'portal',
    menu: SECCIONES,
    bloqueadas: [],
    api: { metodo: 'GET', ruta: '/api/usuarios' },
  },
  {
    nombre: 'PACIENTE adolescente (cuenta restringida)',
    usuario: 'adolescente',
    zona: 'portal',
    menu: ['Resumen', 'Avisos', 'Seguridad'],
    bloqueadas: [
      { ruta: '/portal/pagos', texto: SOLO_RESPONSABLE },
      { ruta: '/portal/documentos', texto: SOLO_RESPONSABLE },
    ],
    api: { metodo: 'GET', ruta: '/api/cobros/liquidaciones' },
  },
  {
    nombre: 'Adulto responsable',
    usuario: 'madre.demo',
    zona: 'portal',
    menu: SECCIONES,
    bloqueadas: [],
    api: { metodo: 'GET', ruta: '/api/directorio' },
  },
];

/** Ultimo access token que entrego el puente de sesion a esta pestaña. */
function capturarToken(page: Page): () => string {
  let token = '';
  page.on('response', async (r) => {
    if (!new URL(r.url()).pathname.startsWith('/sesion/') || !r.ok()) return;
    const cuerpo = (await r.json().catch(() => null)) as { accessToken?: string } | null;
    if (cuerpo?.accessToken) token = cuerpo.accessToken;
  });
  return () => token;
}

for (const c of CASOS) {
  test(`roles: ${c.nombre}`, async ({ page }) => {
    const token = capturarToken(page);
    await ingresar(page, c.usuario, c.zona);
    if (c.rol) {
      await page.getByLabel('Rol activo').selectOption(c.rol);
      await expect(page.getByLabel('Rol activo')).toHaveValue(c.rol);
    }
    const nav = page.getByRole('navigation', { name: c.zona === 'admin' ? 'Menú principal' : 'Secciones de mi cuenta' });
    // El menu termina de armarse cuando llegan los modulos activos.
    await expect(nav.getByRole('link')).toHaveCount(c.menu.length);
    expect(await nav.getByRole('link').allInnerTexts()).toEqual(c.menu.map((m) => expect.stringContaining(m)));

    for (const b of c.bloqueadas) {
      await page.goto(b.ruta);
      await expect(page.getByText(b.texto)).toBeVisible();
    }

    const r = await page.request.fetch(c.api.ruta, {
      method: c.api.metodo,
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      data: c.api.cuerpo,
    });
    expect(r.status()).toBe(403);
  });
}
