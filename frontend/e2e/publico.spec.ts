import { expect, test, type Page } from '@playwright/test';

/**
 * Sitio publico (03b-2) contra la API local, el seed demo y Mailpit
 * (npm run dev en la raiz). Cada prueba usa un correo nuevo: la BD limita a
 * dos solicitudes pendientes por correo.
 */
const MAILPIT = 'http://127.0.0.1:8025/api/v1';
const correoNuevo = (etiqueta: string) => `e2e.${etiqueta}.${Date.now()}@ejemplo.cl`;

/** Enlace (ruta con ?token=) del ultimo correo enviado a `para` que lleve `ruta` (espera hasta 15 s). */
async function enlaceDelCorreo(para: string, ruta = '/pedir-hora/verificar'): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const r = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${para}"`)}`)).json()) as { messages: { ID: string }[] };
    if (r.messages.length) {
      const m = (await (await fetch(`${MAILPIT}/message/${r.messages[0]!.ID}`)).json()) as { Text: string };
      const url = new RegExp(`https?://\\S+${ruta}\\?token=[\\w-]+`).exec(m.Text)?.[0];
      if (url) return new URL(url).pathname + new URL(url).search;
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error(`Sin correo con ${ruta} para ${para}`);
}

/** Desde /pedir-hora/<id>: primera hora libre, datos y envio. Devuelve el correo usado. */
async function pedirHora(page: Page, etiqueta: string, menor = false): Promise<string> {
  const email = correoNuevo(etiqueta);
  await page
    .getByRole('button', { name: /^\d{2}:\d{2}$/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Datos del paciente' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Prueba');
  await page.getByLabel('Apellido').fill('E2E');
  await page.getByLabel('Fecha de nacimiento').fill(menor ? '2012-05-10' : '1990-05-10');
  await page.getByLabel(/^Correo/).fill(email);
  if (menor) {
    await expect(page.getByText('Por la fecha de nacimiento, el paciente es menor de 18.', { exact: false })).toBeVisible();
    await page.getByLabel('Nombre completo').fill('Adulta Responsable');
    await page.getByLabel('Relación con el paciente').fill('Madre');
  }
  await page.getByRole('button', { name: 'Retener la hora y enviar el enlace' }).click();
  // Sin aceptar la politica no se envia.
  await expect(page.getByText('Para pedir hora debes aceptar la política de datos.')).toBeVisible();
  await page.getByLabel(/política de datos personales/).check();
  await page.getByLabel(/términos de agendamiento/).check();
  await page.getByRole('button', { name: 'Retener la hora y enviar el enlace' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
  await expect(page.getByText('Tu hora está retenida')).toBeVisible();
  await expect(page.getByText(/^(29|30):\d{2}$/)).toBeVisible();
  return email;
}

test('landing y equipo: contenido del ADMIN, filtro por atención, perfil con reseñas y sin practicantes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Acompañamiento psicológico, con orden detrás.');
  await expect(page.getByText('Terapia de pareja')).toBeVisible();
  await expect(page.getByText('contacto@centro-prueba.cl')).toBeVisible();

  await page.getByRole('navigation', { name: 'Sitio del centro' }).getByRole('link', { name: 'Equipo' }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page.getByText('Practicante')).toHaveCount(0);
  await page.getByRole('link', { name: 'Psicoterapia infanto-juvenil' }).click();
  await expect(page).toHaveURL(/atencion=Psicoterapia%20infanto-juvenil/);
  await expect(page.getByRole('article')).toHaveCount(1);

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
  await page.getByLabel('Cuéntanos con tus palabras').fill('Texto de prueba E2E.');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click(); // dias: opcional
  await page.getByRole('button', { name: 'Continuar' }).click(); // franjas: opcional
  await page.getByText('FONASA').click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByText('Sin preferencia').click();
  await page.getByRole('button', { name: 'Ver mi resultado' }).click();

  await expect(page.getByRole('heading', { name: 'Te sugerimos a Ps. Profesional Uno (Demo)' })).toBeVisible();
  await expect(page.getByText('Por qué te lo sugerimos').first()).toBeVisible();
  await expect(page.getByText(/tiene convenio FONASA/).first()).toBeVisible();
  // C-17: sin datos de contacto en el match.
  await expect(page.getByLabel(/correo/i)).toHaveCount(0);
  await page
    .getByRole('link', { name: /Pedir hora con/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Elige el horario de tu sesión' })).toBeVisible();
});

test('pedir hora sin cuenta: retiene, correo y confirmación al verificar', async ({ page }) => {
  await page.goto('/equipo');
  await page.getByRole('link', { name: /Ver perfil completo de Ps\. Profesional Uno/ }).click();
  await page.getByRole('link', { name: 'Ver horas disponibles' }).click();
  const email = await pedirHora(page, 'confirmada');
  await page.goto(await enlaceDelCorreo(email));
  await page.getByRole('button', { name: 'Confirmar mi hora' }).click();
  await expect(page.getByRole('heading', { name: 'Tu hora quedó confirmada' })).toBeVisible();
  // El enlace es de un solo uso.
  await page.reload();
  await page.getByRole('button', { name: 'Confirmar mi hora' }).click();
  await expect(page.getByRole('heading', { name: 'Este enlace ya no sirve' })).toBeVisible();
});

test('profesional que aprueba pacientes nuevos: termina en solicitud enviada; menor exige adulto responsable', async ({ page }) => {
  await page.goto('/equipo');
  await page.getByRole('link', { name: /Ver perfil completo de Ps\. Profesional Tres/ }).click();
  await page.getByRole('link', { name: 'Ver horas disponibles' }).click();
  const email = await pedirHora(page, 'menor', true);
  await page.goto(await enlaceDelCorreo(email));
  await page.getByRole('button', { name: 'Confirmar mi hora' }).click();
  await expect(page.getByRole('heading', { name: 'Solicitud enviada' })).toBeVisible();
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
