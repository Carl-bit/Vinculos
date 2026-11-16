import { expect, test } from './prueba';

import { aprobarHora, citaDeReserva, enlaceDelCorreo, ingresar, pacienteNuevo, pedirHora, sqlPrueba } from './apoyo';

/**
 * Sitio publico (03b-2) contra la API local, el seed demo y Mailpit
 * (npm run dev en la raiz). Cada prueba usa un correo nuevo: la BD limita a
 * dos reservas en curso por correo. MVP sin COBROS (2026-11-11): sin paso
 * de pago; la hora queda retenida hasta verificar el correo, luego llega al
 * profesional (SOLICITADA) y queda confirmada cuando el la aprueba.
 */

test('landing y equipo: contenido del ADMIN, filtro por atención, perfil con reseñas y sin practicantes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Acompañamiento psicológico, con orden detrás.');
  await expect(page.getByText('Terapia de pareja').first()).toBeVisible();
  await expect(page.getByText('contacto@centro-prueba.cl')).toBeVisible();

  await page.getByRole('navigation', { name: 'Sitio del centro' }).getByRole('link', { name: 'Equipo' }).click();
  // 03b-4.1: seis profesionales con perfil publico en el seed demo.
  await expect(page.getByRole('article')).toHaveCount(6);
  await expect(page.getByText('Practicante')).toHaveCount(0);
  await page.getByRole('link', { name: 'Psicoterapia infanto-juvenil' }).click();
  await expect(page).toHaveURL(/atencion=Psicoterapia%20infanto-juvenil/);
  await expect(page.getByRole('article')).toHaveCount(2);

  await page.goto('/equipo');
  await page.getByRole('link', { name: /Ver perfil completo de Ps\. Profesional Uno/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ps. Profesional Uno (Demo)');
  await expect(page.getByText('Formación verificada')).toBeVisible();
  await expect(page.getByText('Convenio FONASA')).toBeVisible();
  await expect(page.getByText('Paciente P.')).toBeVisible();
  await expect(page.getByText(/Solo pueden valorar pacientes que tuvieron al menos una sesión/)).toBeVisible();
  // Seccion sin datos (idiomas de Profesional Tres): no aparece.
  await page.goto('/equipo');
  await page.getByRole('link', { name: /Ver perfil completo de Ps\. Profesional Tres/ }).click();
  await expect(page.getByText('Idiomas')).toHaveCount(0);
});

test('match: paso a paso, aviso de riesgo, resultado explicado y lleva a pedir hora', async ({ page }) => {
  await page.goto('/match');
  await page.getByText('Ansiedad').click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByText('Para mí').click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByText('Me supera').click();
  await expect(page.getByRole('alert').filter({ hasText: 'Salud Responde' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  // 03b-4.1: bajo el minimo, Continuar queda deshabilitado y el minimo se ve al escribir.
  await page.getByLabel('Cuéntanos con tus palabras').fill('Corto');
  await expect(page.getByText(/te faltan 5/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  await page.getByLabel('Cuéntanos con tus palabras').fill('Texto de prueba E2E.');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click(); // dias: opcional
  await page.getByRole('button', { name: 'Continuar' }).click(); // franjas: opcional
  await page.getByText('FONASA').click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByText('Sin preferencia').click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  // 03b-4.1: preferencia de pago; el resultado va por tramos con la tarifa visible.
  await page.getByText('Hasta $35.000').click();
  await page.getByRole('button', { name: 'Ver mi resultado' }).click();

  await expect(page.getByRole('heading', { name: 'Te sugerimos a Ps. Profesional Uno (Demo)' })).toBeVisible();
  await expect(page.getByText('Por qué te lo sugerimos').first()).toBeVisible();
  await expect(page.getByText(/tiene convenio FONASA/).first()).toBeVisible();
  await expect(page.getByText('Dentro de tu preferencia').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /más que tu preferencia/ }).first()).toBeVisible();
  await expect(page.getByText(/\$35\.000 por sesión/).first()).toBeVisible();
  // C-17: sin datos de contacto en el match.
  await expect(page.getByLabel(/correo/i)).toHaveCount(0);
  await page
    .getByRole('link', { name: /Pedir hora con/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Elige el horario de tu sesión' })).toBeVisible();
});

test('pedir hora sin cuenta: retiene, verifica el correo, llega al profesional y queda confirmada al aprobarla', async ({ page, context }) => {
  await page.goto('/equipo');
  await page.getByRole('link', { name: /Ver perfil completo de Ps\. Profesional Uno/ }).click();
  await page.getByRole('link', { name: 'Ver horas disponibles' }).click();
  const email = await pedirHora(page, 'confirmada');
  const citaId = citaDeReserva(email);
  expect(sqlPrueba(`SELECT estado FROM citas WHERE id = '${citaId}'`)).toBe('RETENIDA');

  const enlace = await context.newPage();
  await enlace.goto(await enlaceDelCorreo(email));
  await enlace.getByRole('button', { name: 'Confirmar mi hora' }).click();
  await expect(enlace.getByRole('heading', { name: 'Enviamos tu solicitud' })).toBeVisible();
  // El enlace es de un solo uso.
  await enlace.reload();
  await enlace.getByRole('button', { name: 'Confirmar mi hora' }).click();
  await expect(enlace.getByRole('heading', { name: 'Este enlace ya no sirve' })).toBeVisible();

  // La pestaña original pasa sola a "llegó a su profesional" y, al aprobarla, a confirmada.
  await expect(page.getByRole('heading', { name: /^Tu solicitud llegó a / })).toBeVisible({ timeout: 20_000 });
  expect(sqlPrueba(`SELECT estado FROM citas WHERE id = '${citaId}'`)).toBe('SOLICITADA');
  await aprobarHora(page, citaId);
  await expect(page.getByRole('heading', { name: 'Tu hora quedó confirmada' })).toBeVisible({ timeout: 20_000 });
});

test('03b-6: verificar en otra pestaña hace avanzar sola a la original', async ({ page, context }) => {
  await page.goto('/equipo');
  await page.getByRole('link', { name: /Ver perfil completo de Ps\. Profesional Uno/ }).click();
  await page.getByRole('link', { name: 'Ver horas disponibles' }).click();
  const email = await pedirHora(page, 'otra-pestana');
  const otra = await context.newPage();
  await otra.goto(await enlaceDelCorreo(email));
  await otra.getByRole('button', { name: 'Confirmar mi hora' }).click();
  await expect(otra.getByRole('heading', { name: 'Enviamos tu solicitud' })).toBeVisible();
  // La pestaña original consulta el estado cada pocos segundos y avanza sin recargar.
  await expect(page.getByRole('heading', { name: /^Tu solicitud llegó a / })).toBeVisible({ timeout: 20_000 });
});

test('03b-6: reserva sin verificar vence, la hora se libera y se ofrece otra conservando los datos', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/equipo');
  await page.getByRole('link', { name: /Ver perfil completo de Ps\. Profesional Uno/ }).click();
  await page.getByRole('link', { name: 'Ver horas disponibles' }).click();
  const email = await pedirHora(page, 'vence');
  // Simula los 30 minutos: el plazo queda vencido y el job (cada minuto) libera la hora.
  sqlPrueba(`UPDATE citas SET retencion_vence_en = now() - interval '1 second' WHERE id = (SELECT cita_id FROM solicitudes_hora WHERE email = '${email}')`);
  await expect(page.getByRole('heading', { name: 'La hora se liberó' })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Venció el plazo y la hora quedó disponible para otras personas.')).toBeVisible();
  // La pantalla puede adelantarse al job (el estado ya ve el plazo vencido); la solicitud expira con el job.
  await expect.poll(() => sqlPrueba(`SELECT estado FROM solicitudes_hora WHERE email = '${email}'`), { timeout: 90_000, intervals: [5_000] }).toBe('EXPIRADA');
});

test('ya soy paciente: solo pide el correo y responde siempre igual', async ({ page }) => {
  for (const email of ['paciente@centro-prueba.cl', 'no.existe@ejemplo.cl']) {
    await page.goto('/pedir-hora');
    await page.getByRole('button', { name: /No, ya soy paciente/ }).click();
    await page.getByLabel('Correo con el que te atiendes').fill(email);
    await page.getByRole('button', { name: 'Recibir enlace de acceso' }).click();
    await expect(page.getByRole('status')).toContainText(`Si existe una cuenta con ${email}, te enviamos un enlace`);
    await expect(page.getByText(/Profesional (Uno|Dos|Tres)/)).toHaveCount(0);
  }
});

test('03b-6: consentimiento por token: recepción lo envía, el paciente responde desde el correo y el enlace es de un uso', async ({ page, browser }) => {
  // Paciente nuevo: reserva verificada y aprobada por su profesional.
  const { email, pacienteId } = await pacienteNuevo(page, 'consentimiento');

  const equipo = await (await browser.newContext()).newPage();
  await ingresar(equipo, 'gestion');
  await equipo.goto(`/admin/fichas/${pacienteId}`);
  await equipo.getByRole('button', { name: 'Enviar enlace por correo' }).click();
  await expect(equipo.getByText(/Enviamos el enlace por correo/)).toBeVisible();

  await page.goto(await enlaceDelCorreo(email, '/consentimiento'));
  await expect(page.getByText('Si aceptas', { exact: true })).toBeVisible();
  await expect(page.getByText('Si no aceptas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Acepto el consentimiento' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sí, acepto' }).click();
  await expect(page.getByRole('heading', { name: 'Registramos tu respuesta' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Este enlace ya no sirve' })).toBeVisible();

  await equipo.reload();
  await expect(equipo.getByRole('region', { name: 'Consentimientos' }).getByText(/Firmado/)).toBeVisible();
});

test.describe('recordatorio por correo (AUD-02, modo de prueba JOBS_MANUALES)', () => {
  let horasAntes = '';
  test.afterAll(() => {
    if (horasAntes) sqlPrueba(`UPDATE configuracion_centro SET recordatorio_horas_antes = ${horasAntes}`);
  });

  test('el job envia el enlace; muestra la politica que aplica, confirma la asistencia y el enlace sirve una vez', async ({ page }) => {
    const { email } = await pacienteNuevo(page, 'recordatorio', 'Cinco');
    const horas = Number(
      sqlPrueba(`SELECT extract(epoch FROM c.inicio - now()) / 3600 FROM solicitudes_hora s JOIN citas c ON c.id = s.cita_id WHERE s.email = '${email}'`),
    );
    test.skip(horas > 167, 'La primera hora libre esta a mas de una semana (maximo del recordatorio)');
    // La ventana del recordatorio cubre la cita (configuracion del centro: hasta 168 h).
    horasAntes = sqlPrueba('SELECT recordatorio_horas_antes FROM configuracion_centro');
    sqlPrueba(`UPDATE configuracion_centro SET recordatorio_horas_antes = greatest(${Math.ceil(horas) + 1}, ${horasAntes})`);

    // Modo de prueba: corre el job ahora en vez de esperar su cron de 10 minutos.
    const r = await page.request.post('/api/pruebas/jobs/enviar_recordatorios');
    expect(r.status()).toBe(200);

    await page.goto(await enlaceDelCorreo(email, '/recordatorio'));
    await expect(page.getByRole('heading', { name: 'Recordatorio de tu hora' })).toBeVisible();
    await expect(page.getByText(/Si cancelas ahora/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirmo que asistiré' }).click();
    await expect(page.getByRole('heading', { name: '¡Te esperamos!' })).toBeVisible();
    await expect(page.getByText('Confirmaste tu asistencia.', { exact: false })).toBeVisible();
    await page.reload();
    await expect(page.getByText('Ya respondiste este recordatorio')).toBeVisible();
  });
});
