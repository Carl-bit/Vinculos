import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { test } from '@playwright/test';

import { ingresarEquipo } from './apoyo';
import { aMarkdown } from './volcado';

/**
 * Volcado de "Fichas y Pacientes" vista por la cuenta ADMIN a un solo .md
 * (todas las pestañas del modulo, el alta de paciente y el detalle de un
 * paciente) para revisar contra el prototipo, igual que zz-configuracion-md.
 * Solo con FICHAS_MD=<ruta .md>; no es parte de la suite normal. Seed demo.
 */
const DESTINO = process.env.FICHAS_MD;

// Cada seccion por su ?vista= (las pestañas llevan contadores, p. ej. «Derivaciones (1)»).
const SECCIONES: { etiqueta: string; vista: string; componente: string }[] = [
  { etiqueta: 'Seguimiento', vista: 'equipo', componente: 'pacientes/SeguimientoEquipo.tsx' },
  { etiqueta: 'Pacientes', vista: 'pacientes', componente: 'pacientes/ListaPacientes.tsx' },
  { etiqueta: 'Derivaciones', vista: 'derivaciones', componente: 'pacientes/Derivaciones.tsx' },
  { etiqueta: 'Accesos temporales', vista: 'accesos', componente: 'pacientes/AccesosTemporales.tsx' },
  { etiqueta: 'Prácticas', vista: 'practicas', componente: 'pacientes/ConsentimientosEquipo.tsx' },
  { etiqueta: 'Configuración clínica · Plantillas', vista: 'plantillas', componente: 'pacientes/PlantillasClinicas.tsx' },
  { etiqueta: 'Configuración clínica · Catálogos', vista: 'catalogos', componente: 'pacientes/CatalogosClinicos.tsx' },
  { etiqueta: 'Configuración clínica · Retención', vista: 'retencion', componente: 'pacientes/RetencionFichas.tsx' },
];

test('fichas y pacientes (admin) a markdown', async ({ page }) => {
  test.skip(!DESTINO, 'Solo con FICHAS_MD=<ruta .md>');
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/fichas');
  const esperar = async () => {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(700);
  };
  const main = page.locator('main');
  const partes: string[] = [
    '# Fichas y Pacientes, cuenta administradora (volcado)',
    '',
    `Generado ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })} desde \`/admin/fichas\` como **admin** del seed demo (Centro de Prueba). ` +
      'Datos de demostración, sin datos reales. Convención: `- **Campo** (tipo): valor`, `[x]`/`[ ]` casillas e interruptores, `[botón]` acciones disponibles.',
    '',
    `Pestañas: ${SECCIONES.map((s) => s.etiqueta).join(' · ')} · más «Nuevo paciente» y el detalle de un paciente.`,
  ];

  // Encabezado y pestañas salen una vez (primera seccion); despues se ocultan del volcado con aria-hidden.
  const repetidos = 'main > div:first-child, main [role=tablist][aria-label="Secciones"]';
  const marcarRepetidos = (ocultar: boolean) =>
    page
      .locator(repetidos)
      .evaluateAll((els, o) => els.forEach((e) => (o ? e.setAttribute('aria-hidden', 'true') : e.removeAttribute('aria-hidden'))), ocultar);
  for (const [i, s] of SECCIONES.entries()) {
    await page.goto(`/admin/fichas?vista=${s.vista}`);
    await esperar();
    if (i > 0) await marcarRepetidos(true);
    const md = await main.evaluate(aMarkdown);
    await marcarRepetidos(false);
    partes.push('', '---', '', `## ${s.etiqueta}`, '', `_Componente: \`frontend/src/components/${s.componente}\`_`, '', md || '_(sin contenido)_');
  }

  // Alta de paciente (modal del encabezado).
  await page.getByRole('button', { name: 'Nuevo paciente' }).first().click();
  const modal = page.getByRole('dialog');
  await modal.waitFor();
  partes.push(
    '',
    '---',
    '',
    '## Nuevo paciente (modal)',
    '',
    '_Componente: `frontend/src/components/pacientes/NuevoPaciente.tsx` + `AltaPaciente.tsx`_',
    '',
    await modal.evaluate(aMarkdown),
  );
  await page.keyboard.press('Escape');

  // Detalle del primer paciente de la lista: una sola pagina con indice (encabezado fijo y secciones).
  await page.goto('/admin/fichas?vista=pacientes');
  await esperar();
  await page.locator('main a[href^="/admin/fichas/"]').first().click();
  await page.waitForURL(/\/admin\/fichas\/[^/?]+/);
  await esperar();
  partes.push(
    '',
    '---',
    '',
    '## Detalle del paciente (ficha completa)',
    '',
    '_Componente: `frontend/src/components/pacientes/DetallePaciente.tsx` + `SeccionesPaciente.tsx`_',
    '',
    await main.evaluate(aMarkdown),
  );

  mkdirSync(dirname(DESTINO!), { recursive: true });
  writeFileSync(DESTINO!, partes.join('\n') + '\n', 'utf8');
});
