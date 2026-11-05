import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { test } from '@playwright/test';

import { ingresarEquipo } from './apoyo';
import { aMarkdown } from './volcado';

/**
 * Volcado de "Configuracion del centro" a un solo .md (todas las pestañas,
 * campos con su valor actual) para revisar contra el prototipo. Solo con
 * CONFIG_MD=<ruta .md>; no es parte de la suite normal. Datos del seed demo.
 */
const DESTINO = process.env.CONFIG_MD;

const SECCIONES: { etiqueta: string; componente: string }[] = [
  { etiqueta: 'Datos y página pública', componente: 'nucleo/DatosCentro.tsx' },
  { etiqueta: 'Horario y feriados', componente: 'nucleo/HorarioPoliticasCentro.tsx (HorarioCentroEditor) + nucleo/FeriadosCentro.tsx' },
  { etiqueta: 'Agenda y plazos', componente: 'nucleo/ReglasCentro.tsx (seccion="agenda")' },
  { etiqueta: 'Cobros y acuerdos', componente: 'nucleo/ReglasCentro.tsx (seccion="cobros") + cobros/AcuerdosProfesionales.tsx' },
  { etiqueta: 'Medios de pago', componente: 'nucleo/MediosPagoCentro.tsx' },
  { etiqueta: 'Avisos al paciente y equipo', componente: 'nucleo/PlantillasMensaje.tsx' },
  { etiqueta: 'Roles y accesos', componente: 'nucleo/ReglasCentro.tsx (seccion="roles")' },
  { etiqueta: 'Consentimientos y políticas', componente: 'nucleo/HorarioPoliticasCentro.tsx (PoliticasCentro)' },
  { etiqueta: 'Datos personales y auditoría', componente: 'nucleo/SolicitudesDerechos.tsx + AuditoriaAccesos.tsx + ExportacionCentro.tsx' },
  { etiqueta: 'Módulos, contrato y soporte', componente: 'nucleo/ReglasCentro.tsx (seccion="modulos") + ContratoCentro.tsx + SoporteCentro.tsx' },
];

test('configuracion del centro a markdown', async ({ page }) => {
  test.skip(!DESTINO, 'Solo con CONFIG_MD=<ruta .md>');
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ingresarEquipo(page, 'admin');
  await page.goto('/admin/configuracion');
  const partes: string[] = [
    '# Configuración del centro (volcado)',
    '',
    `Generado ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })} desde \`/admin/configuracion\` como **admin** del seed demo (Centro de Prueba). ` +
      'Datos de demostración, sin datos reales. Convención: `- **Campo** (tipo): valor`, `[x]`/`[ ]` casillas e interruptores, `[botón]` acciones disponibles.',
    '',
    `Secciones: ${SECCIONES.map((s) => s.etiqueta).join(' · ')}`,
  ];
  for (const s of SECCIONES) {
    await page
      .getByRole('navigation', { name: 'Secciones de configuración' })
      .getByRole('button', { name: new RegExp(`^${s.etiqueta}`) })
      .click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(700);
    const md = await page.locator('#configuracion-panel').evaluate(aMarkdown);
    partes.push('', '---', '', `## ${s.etiqueta}`, '', `_Componente: \`frontend/src/components/${s.componente}\`_`, '', md || '_(sin contenido)_');
    // Avisos: cada celda abre su plantilla en el editor lateral; se vuelca el editor de cada una.
    const celdas = page.locator('#configuracion-panel section[aria-label="Avisos"] button[aria-pressed]:not([aria-label^="Filtrar"])');
    const total = s.etiqueta.startsWith('Avisos') ? await celdas.count() : 0;
    for (let i = 0; i < total; i++) {
      const celda = celdas.nth(i);
      if (!(await celda.getAttribute('aria-label'))?.includes(',')) continue;
      await celda.click({ timeout: 5000 });
      await page.waitForTimeout(200);
      const detalle = await page.getByRole('complementary', { name: 'Editar plantilla' }).evaluate(aMarkdown);
      partes.push('', `### ${(await celda.getAttribute('aria-label')) ?? `Plantilla ${i + 1}`}`, '', detalle);
    }
  }
  mkdirSync(dirname(DESTINO!), { recursive: true });
  writeFileSync(DESTINO!, partes.join('\n') + '\n', 'utf8');
});
