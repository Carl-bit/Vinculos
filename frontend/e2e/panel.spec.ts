import { expect, test, type Page } from '@playwright/test';

/** Backoffice 03b-4 contra la API local y el seed demo (docs/pruebas/guion_manual.md). */
const PASSWORD = 'dev-password';

async function ingresarAdmin(page: Page) {
  await page.goto('/ingreso');
  await page.getByRole('button', { name: 'Soy del equipo' }).click();
  await page.getByLabel('Correo del centro').fill('admin@centro-prueba.cl');
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar al panel' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test('Agenda: agendar retiene la hora con cuenta regresiva y solo confirma al pulsar', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/agenda?nueva=1');
  const modal = page.getByRole('dialog', { name: 'Agendar sesión' });
  await modal.getByLabel('Paciente').selectOption({ label: 'Prueba, Paciente' });
  await expect(modal.getByText(/Horas libres de/)).toBeVisible();

  // Elegir una hora crea el soft-lock (UX); la cita aun no existe.
  await modal.locator('button[aria-pressed]').first().click();
  await expect(modal.getByText('En proceso de reserva')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Confirmar cita' })).toBeVisible();

  // Soltar la retencion vuelve a la grilla; elegir de nuevo y confirmar.
  await modal.getByRole('button', { name: 'Elegir otra hora' }).click();
  await modal.locator('button[aria-pressed]').first().click();
  const creacion = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/citas');
  await modal.getByRole('button', { name: 'Confirmar cita' }).click();
  const respuesta = await creacion;
  expect(respuesta.status()).toBe(201);
  const { id } = (await respuesta.json()) as { id: string };

  try {
    await expect(page.getByRole('dialog', { name: 'Cita agendada' })).toBeVisible();
    await page.getByRole('button', { name: 'Listo' }).click();
    await expect(page).toHaveURL(/\/admin\/agenda$/);
  } finally {
    // La cita es real: se cancela (nunca se borra) para liberar la hora y que
    // el test se pueda repetir sin ensuciar la BD de desarrollo.
    const cancelacion = await page.request.patch(`/api/citas/${id}/cancelacion`, {
      headers: { authorization: (await respuesta.request().headerValue('authorization')) ?? '' },
    });
    expect(cancelacion.ok()).toBe(true);
  }
});

test('Agenda: pestañas de espacios, horarios del equipo y pendientes', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/agenda?vista=espacios');
  await expect(page.getByRole('heading', { name: 'Box 1 (Demo)' })).toBeVisible();
  await expect(page.getByRole('meter', { name: /Horas apartadas de Box 1/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Horarios del equipo' }).click();
  await expect(page).toHaveURL(/vista=equipo/);
  await expect(page.getByRole('heading', { name: 'Profesional Uno' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apartar horas' }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Pendientes' }).click();
  await expect(page.getByRole('heading', { name: 'Pago pendiente' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Por reprogramar' })).toBeVisible();
});

test('Agenda: el detalle de una sesion futura ofrece cubrir sesion y explica la derivacion', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/agenda');
  await page.getByRole('button', { name: 'Semana siguiente' }).click();
  await page.getByRole('region', { name: 'Calendario de la semana' }).getByRole('button').filter({ hasText: 'Confirmada' }).first().click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByText('Cambio definitivo de profesional')).toBeVisible();
  await modal.getByRole('button', { name: 'Cubrir sesión' }).click();
  await expect(modal.getByLabel('Profesional que cubre')).toBeVisible();
  // ADMIN puede otorgar el acceso temporal en el mismo paso.
  await modal.getByLabel('Profesional que cubre').selectOption({ index: 1 });
  await expect(modal.getByRole('button', { name: /cubrir/i }).last()).toBeEnabled();
});

test('Cobros: resumen del periodo y "registrar asistencia y pago" de una sesion', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/cobros');
  await expect(page.getByRole('heading', { name: 'Liquidación por profesional' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Comisión del centro' })).toBeVisible();
  await page.getByRole('tab', { name: 'Asistencia y pago' }).click();
  await page.getByRole('tab', { name: 'Todas' }).click();
  await page.getByRole('button', { name: 'Asistencia y pago' }).first().click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByText('Monto de la sesión')).toBeVisible();
  await expect(modal.getByText('Saldo')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Liquidaciones' }).click();
  await expect(page.getByRole('heading', { name: 'Arriendos de box' })).toBeVisible();
});

test('Configuracion (ADMIN): politicas versionadas y plantillas de mensaje', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/configuracion');
  await expect(page.getByRole('heading', { name: 'Identidad del centro' })).toBeVisible();
  await page.getByRole('tab', { name: 'Consentimiento y políticas' }).click();
  await expect(page.getByRole('heading', { name: 'Consentimiento informado' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reglas del sistema' })).toBeVisible();
  await page.getByRole('tab', { name: 'Notificaciones' }).click();
  await page.getByRole('button', { expanded: false }).first().click();
  await expect(page.getByRole('button', { name: 'Restaurar ejemplo' })).toBeVisible();
  await page.getByRole('tab', { name: 'Reglas y plazos' }).click();
  await expect(page.getByLabel('Cargo por inasistencia')).toBeVisible();
});

test('Equipo: ficha de un profesional con revisiones y cuenta; practicantes con fecha de acceso', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/equipo');
  await page.getByRole('button', { name: /Profesional Uno/ }).click();
  await expect(page.getByRole('heading', { name: 'Tipos de atención y especialidades' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cuenta' })).toBeVisible();
  await page.getByRole('tab', { name: 'Practicantes' }).click();
  await expect(page.getByRole('table', { name: 'Practicantes' })).toBeVisible();
});

test('Match: preguntas del cuestionario, filtro directo y metricas', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/match');
  await expect(page.getByRole('heading', { name: 'Preguntas del cuestionario' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Filtro directo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Métricas básicas' })).toBeVisible();
});

test('Mi perfil: cuenta y contraseña; sin perfil profesional para una cuenta madre que no atiende', async ({ page }) => {
  await ingresarAdmin(page);
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Mi perfil' }).click();
  await expect(page.getByRole('heading', { name: 'Mi cuenta' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cambiar contraseña' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mis datos y descripción' })).toHaveCount(0);
});
