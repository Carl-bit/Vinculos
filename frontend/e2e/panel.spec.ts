import { expect, test, type Page } from '@playwright/test';

import { ingresarEquipo } from './apoyo';

const ingresarAdmin = (page: Page) => ingresarEquipo(page, 'admin');

/** Backoffice 03b-4 contra la API local y el seed demo (docs/pruebas/guion_manual.md). */
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

test('Agenda: pestañas de espacios y pendientes; horarios y boxes desde el encabezado', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/agenda?vista=espacios');
  await expect(page.getByRole('heading', { name: 'Box 1 (Demo)' })).toBeVisible();
  await expect(page.getByRole('meter', { name: /Horas apartadas de Box 1/ })).toBeVisible();

  // 03b-4.2: "Horarios del equipo" deja de ser pestaña; queda como accion del encabezado.
  await expect(page.getByRole('tab', { name: 'Horarios del equipo' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Horarios y boxes' }).click();
  await expect(page).toHaveURL(/vista=horarios/);
  await expect(page.getByRole('heading', { name: 'Profesional Uno' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apartar horas' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Volver a la agenda' }).click();
  await page.getByRole('tab', { name: 'Pendientes' }).click();
  await expect(page.getByRole('heading', { name: 'Pago pendiente' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Por reprogramar' })).toBeVisible();
});

test('Agenda: el detalle de una sesion futura ofrece cubrir sesion y explica la derivacion', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/agenda');
  await page.getByRole('button', { name: 'Semana siguiente' }).click();
  // 03b-4.2: el estado va en el nombre accesible de la tarjeta (simbolo + texto).
  await page
    .getByRole('region', { name: 'Calendario' })
    .getByRole('button', { name: /Confirmada/ })
    .first()
    .click();
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
  await expect(page.getByRole('heading', { name: 'Identidad y contacto' })).toBeVisible();
  const secciones = page.getByRole('navigation', { name: 'Secciones de configuración' });
  await secciones.getByRole('button', { name: /^Consentimientos y políticas/ }).click();
  await expect(page.getByRole('heading', { name: 'Consentimiento informado' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Reglas del sistema' })).toBeVisible();
  await secciones.getByRole('button', { name: /^Avisos al paciente y equipo/ }).click();
  await page.getByRole('button', { name: /^Cita cancelada, equipo · correo/ }).click();
  await expect(page.getByRole('complementary', { name: 'Editar plantilla' })).toContainText('Equipo · correo');
  await expect(page.getByRole('button', { name: 'Restaurar ejemplo' })).toBeVisible();
  await secciones.getByRole('button', { name: /^Cobros y acuerdos/ }).click();
  await expect(page.getByLabel('Cargo por inasistencia')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Cobra el centro/ })).toBeChecked();
  // El buscador filtra el submenu.
  await page.getByLabel('Buscar un ajuste').fill('feriado');
  await expect(secciones.getByRole('button')).toHaveText([/Horario y feriados/]);
});

test('Match: el asa mueve preguntas salvo con una abierta', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/match');
  const asas = page.getByRole('button', { name: /^Mover «/ });
  await expect(asas.first()).toHaveAttribute('aria-disabled', 'false');
  // Arrastre real: la primera pasa al tercer lugar y sobrevive a recargar; las flechas la devuelven.
  const nombre = (await asas.first().getAttribute('aria-label'))!;
  const origen = (await asas.nth(0).boundingBox())!;
  const destino = (await asas.nth(2).boundingBox())!;
  await page.mouse.move(origen.x + origen.width / 2, origen.y + origen.height / 2);
  await page.mouse.down();
  await page.mouse.move(destino.x + destino.width / 2, destino.y + destino.height / 2 + 20, { steps: 12 });
  await page.mouse.up();
  await expect(asas.nth(2)).toHaveAttribute('aria-label', nombre);
  await expect(asas.first()).toHaveAttribute('aria-disabled', 'false');
  await page.reload();
  await expect(asas.nth(2)).toHaveAttribute('aria-label', nombre);
  await asas.nth(2).press('ArrowUp');
  await expect(asas.nth(1)).toHaveAttribute('aria-label', nombre);
  await expect(asas.first()).toHaveAttribute('aria-disabled', 'false');
  await asas.nth(1).press('ArrowUp');
  await expect(asas.first()).toHaveAttribute('aria-label', nombre);
  await expect(asas.first()).toHaveAttribute('aria-disabled', 'false');
  await page.getByRole('button', { expanded: false }).first().click();
  await expect(page.getByText('Cierra las preguntas abiertas para poder moverlas.')).toBeVisible();
  await expect(asas.first()).toHaveAttribute('aria-disabled', 'true');
});

test('Notificaciones: datos con llaves simples', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/configuracion?vista=notificaciones');
  await expect(page.getByRole('textbox', { name: 'Mensaje' })).toHaveValue(/\{paciente\}/);
  await expect(page.getByRole('textbox', { name: 'Mensaje' })).not.toHaveValue(/\{\{/);
});

test('Equipo: ficha de un profesional con revisiones y cuenta; practicantes con fecha de acceso', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/equipo');
  // 03b-4.1 (pendientes 1 y 2): tira agrupada por rol y "Rol dentro del centro" en pastillas.
  await expect(page.getByRole('group', { name: 'Profesional', exact: true })).toBeVisible();
  // La tira se desplaza dentro de su caja: la pagina no queda con scroll horizontal.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: /Profesional Uno/ }).click();
  await expect(page.getByRole('heading', { name: 'Tipos de atención y especialidades' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cuenta' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Rol dentro del centro' })).toContainText('Profesional· principal');
  await page
    .locator('label')
    .filter({ hasText: /Ver lista$/ })
    .click();
  await expect(page.getByRole('group', { name: 'Profesional', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Profesional Uno/ })).toBeVisible();
  await page.locator('label').filter({ hasText: /Tira$/ }).click();
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

test('Mi cuenta: contacto, seguridad y sin perfil público para quien no atiende (GESTION)', async ({ page }) => {
  await ingresarEquipo(page, 'gestion');
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Mi perfil' }).click();
  // Sin perfil profesional, "Mi perfil" lleva directo a Mi cuenta.
  await expect(page).toHaveURL(/\/admin\/perfil\/cuenta/);
  await expect(page.getByRole('heading', { level: 1, name: 'Datos de contacto' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Contacto privado' })).toBeVisible();
  const secciones = page.getByRole('navigation', { name: 'Secciones de la cuenta' });
  await expect(secciones.getByRole('button', { name: /Pagos y liquidaciones/ })).toHaveCount(0);
  await secciones.getByRole('button', { name: 'Seguridad' }).click();
  await expect(page).toHaveURL(/seccion=seguridad/);
  await expect(page.getByLabel('Contraseña actual')).toBeVisible();
  await expect(page.getByText('Es obligatoria para el equipo del centro.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Volver a mi perfil público' })).toHaveCount(0);
});

test('Mi perfil del profesional (diseño "Moderno A"): lienzo editable con inspector, vista del paciente y Mi cuenta privada', async ({ page }) => {
  await ingresarEquipo(page, 'profesional1');
  await page.goto('/admin/perfil');
  const lienzo = page.getByRole('article', { name: 'Vista previa de mi perfil público' });
  await expect(lienzo).toContainText('Ps. Profesional Uno (Demo)');
  const editor = page.getByRole('complementary', { name: 'Editor del perfil' });
  await expect(editor.getByRole('heading', { name: 'Toca cualquier parte de tu perfil para editarla' })).toBeVisible();

  // Editar la frase: el lienzo la muestra en vivo; cambiar de seccion con cambios pide confirmar.
  await lienzo.getByRole('button', { name: 'Editar Frase destacada' }).click();
  await expect(lienzo.getByRole('button', { name: 'Editar Frase destacada' })).toHaveAttribute('aria-pressed', 'true');
  await editor.getByLabel('Frase').fill('Frase de prueba en vivo');
  await expect(lienzo).toContainText('Frase de prueba en vivo');
  await expect(page.getByRole('toolbar', { name: 'Mi perfil' })).toContainText('Cambios sin guardar');
  await lienzo.getByRole('button', { name: 'Editar Sobre mí' }).click();
  const confirmar = page.getByRole('dialog', { name: 'Estás modificando "Frase destacada"' });
  await confirmar.getByRole('button', { name: 'Sí, descartar' }).click();
  await expect(lienzo).not.toContainText('Frase de prueba en vivo');
  await expect(editor.getByRole('heading', { name: 'Sobre mí' })).toBeVisible();

  // Formacion: un titulo nuevo pide el enlace a su respaldo.
  await lienzo.getByRole('button', { name: 'Editar Formación' }).click();
  await expect(editor.getByLabel('Enlace al respaldo del título')).toBeVisible();

  // Asi lo ven los pacientes: la pagina publica con lo guardado.
  await page.getByRole('button', { name: 'Ver cómo me ven los pacientes' }).click();
  await expect(page.getByRole('region', { name: 'Así ven mi perfil los pacientes' }).getByRole('heading', { level: 1 })).toHaveText(
    'Ps. Profesional Uno (Demo)',
  );
  await page.getByRole('button', { name: 'Volver a editar' }).click();

  // Mi cuenta: lo privado, con mis pacientes y el pago.
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page).toHaveURL(/\/admin\/perfil\/cuenta/);
  const secciones = page.getByRole('navigation', { name: 'Secciones de la cuenta' });
  await secciones.getByRole('button', { name: 'Mis pacientes' }).click();
  await expect(page.getByRole('link', { name: /Paciente Prueba/ }).first()).toBeVisible();
  await secciones.getByRole('button', { name: 'Pagos y liquidaciones' }).click();
  await expect(page.getByRole('heading', { name: 'Mi acuerdo con el centro' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Datos para pagos' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a mi perfil público' }).click();
  await expect(page).toHaveURL(/\/admin\/perfil$/);
});

test('Mi perfil de la cuenta madre (punto 22): su perfil profesional con ADMIN activo y "Trabajar como Profesional"', async ({ page }) => {
  await ingresarAdmin(page);
  await page.goto('/admin/perfil');
  await expect(page).toHaveURL(/\/admin\/perfil\/cuenta/);
  await page.getByRole('navigation', { name: 'Secciones de la cuenta' }).getByRole('button', { name: 'Mi perfil profesional' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Mi perfil profesional' })).toBeVisible();
  await expect(page.getByLabel('Nombre público (opcional)')).toHaveValue('Ps. Admin Centro Prueba (Demo)');
  // Con ADMIN activo no aprueba ni verifica lo propio.
  await expect(page.getByRole('button', { name: 'Asignar tipos' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Ver mi agenda' }).click();
  await expect(page).toHaveURL(/\/admin\/agenda\?equipo=/);
  await expect(page.getByRole('status').filter({ hasText: 'Viendo a' })).toContainText('Admin');
  await page.goto('/admin/perfil/cuenta?seccion=perfil-profesional');
  await page.getByRole('button', { name: 'Trabajar como Profesional' }).click();
  await expect(page.getByLabel('Rol activo')).toHaveValue('PROFESIONAL');
  await expect(page).toHaveURL(/\/admin\/perfil$/);
  await expect(page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Configuración' })).toHaveCount(0);
});

for (const usuario of ['admin', 'profesional1'] as const) {
  test(`Agenda 1920x1080 (${usuario}): sin scroll de la pagina, grilla 08-24 entera en la ventana y vistas Día | Semana | Mes`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await ingresarEquipo(page, usuario);
    await page.goto('/admin/agenda');
    await expect(page.getByRole('heading', { level: 1, name: usuario === 'admin' ? 'Coordinación del centro' : 'Mi agenda' })).toBeVisible();
    await expect(page.getByRole('tab', { name: usuario === 'admin' ? 'Por profesional' : 'Mi horario' })).toBeVisible();
    const vistas = page.getByRole('group', { name: 'Vista de la agenda' });
    // Opcion A (semana unificada): Dia | Semana | Mes.
    for (const vista of ['Día', 'Semana', 'Mes']) await expect(vistas.getByRole('radio', { name: vista })).toHaveCount(1);
    const grilla = page.getByRole('region', { name: 'Calendario' });
    await expect(grilla).toBeVisible();
    // Tras la animacion de entrada (desplaza el main unos px al aparecer).
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
    // 08:00 a 24:00 caben enteras: la grilla no necesita scroll vertical.
    await expect(grilla.getByText('08:00', { exact: true }).first()).toBeVisible();
    await expect(grilla.getByText('23:00', { exact: true }).first()).toBeVisible();
    expect(await grilla.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    await vistas.locator('label').filter({ hasText: /Mes$/ }).click();
    await expect(page.getByRole('region', { name: 'Calendario del mes' })).toBeVisible();
    await vistas
      .locator('label')
      .filter({ hasText: /Semana$/ })
      .click();
  });
}
