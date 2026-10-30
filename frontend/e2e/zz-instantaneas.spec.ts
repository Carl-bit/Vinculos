import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, type Page } from '@playwright/test';

import { ingresar } from './apoyo';

/**
 * 03b-4.1 (pendiente 21): `impeccable detect` no inicia sesion, asi que cada
 * vista se guarda como HTML ya renderizado, con los estilos en linea y sin
 * scripts, y el detector corre sobre esos archivos con todas sus reglas
 * (contraste, texto chico):
 *
 *   INSTANTANEAS=<carpeta> [ANCHO=390] npx playwright test e2e/zz-instantaneas.spec.ts
 *   npx impeccable detect <carpeta>
 *
 * Sin INSTANTANEAS no corre (no es parte de la suite normal). Deja tambien una
 * captura PNG por vista para revisar a mano; no van al repo.
 */
const DESTINO = process.env.INSTANTANEAS;
const ANCHO = Number(process.env.ANCHO ?? 1280);

const VISTAS: { usuario: string | null; zona?: 'admin' | 'portal'; rutas: string[] }[] = [
  { usuario: null, rutas: ['/', '/equipo', '/match', '/pedir-hora', '/ingreso', '/derechos', '/exportacion?token=prueba-de-instantanea'] },
  {
    usuario: 'admin',
    zona: 'admin',
    rutas: [
      '/admin',
      '/admin/perfil',
      '/admin/agenda',
      '/admin/equipo',
      '/admin/cobros',
      '/admin/configuracion',
      '/admin/configuracion?vista=politicas',
      '/admin/configuracion?vista=reglas',
      '/admin/configuracion?vista=auditoria',
      '/admin/configuracion?vista=derechos',
      '/admin/configuracion?vista=feriados',
      '/admin/configuracion?vista=soporte',
      '/admin/configuracion?vista=exportacion',
      '/admin/match',
      '/admin/fichas',
      '/admin/mensajes',
    ],
  },
  { usuario: 'profesional1', zona: 'admin', rutas: ['/admin', '/admin/perfil', '/admin/agenda', '/admin/fichas', '/admin/cobros', '/admin/mensajes'] },
  {
    usuario: 'paciente',
    zona: 'portal',
    rutas: ['/portal', '/portal/pedir-hora', '/portal/pagos', '/portal/documentos', '/portal/seguridad', '/portal/consentimientos', '/portal/avisos'],
  },
];

/** HTML de la pagina con cada hoja de estilos en linea (urls absolutas al front local) y sin scripts. */
async function htmlAutonomo(page: Page): Promise<string> {
  let html = await page.content();
  const hojas = await page.locator('link[rel="stylesheet"]').evaluateAll((ls) => ls.map((l) => (l as HTMLLinkElement).href));
  for (const href of hojas) {
    const css = (await (await page.request.get(href)).text()).replace(/url\((["']?)\//g, `url($1${new URL(href).origin}/`);
    const ruta = new URL(href).pathname + new URL(href).search;
    html = html.replace(
      new RegExp(`<link[^>]*href="${ruta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '(?:&|&amp;)')}"[^>]*>`),
      () => `<style>${css}</style>`,
    );
  }
  return html.replace(/<script[\s\S]*?<\/script>/g, '');
}

for (const v of VISTAS) {
  test(`instantaneas: ${v.usuario ?? 'publico'}`, async ({ page }) => {
    test.skip(!DESTINO, 'Solo con INSTANTANEAS=<carpeta>');
    test.setTimeout(180_000);
    mkdirSync(DESTINO!, { recursive: true });
    await page.setViewportSize({ width: ANCHO, height: 900 });
    if (v.usuario) await ingresar(page, v.usuario, v.zona);
    for (const ruta of v.rutas) {
      await page.goto(ruta);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      const nombre = `${ANCHO}-${v.usuario ?? 'publico'}${ruta === '/' ? '_inicio' : ruta.replace(/[/?=&]/g, '_')}`;
      writeFileSync(join(DESTINO!, `${nombre}.html`), await htmlAutonomo(page));
      await page.screenshot({ path: join(DESTINO!, `${nombre}.png`), fullPage: true });
    }
  });
}
