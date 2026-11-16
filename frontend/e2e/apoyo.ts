import { execFileSync } from 'node:child_process';

import { expect, type Page } from '@playwright/test';

/** Seed demo (docs/pruebas/usuarios_demo.md). */
export const PASSWORD = 'dev-password';
export const correo = (u: string) => `${u}@centro-prueba.cl`;
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/**
 * 03b-4.1: ultimo codigo de verificacion enviado a un correo, leido de la API
 * de Mailpit. `despues`: solo correos posteriores (el codigo anterior queda
 * anulado al emitir otro).
 */
export async function codigoCorreo(destino: string, despues: Date): Promise<string> {
  for (let intento = 0; intento < 40; intento++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${destino}" subject:"código de verificación"`)}&limit=5`);
    const { messages = [] } = (await r.json()) as { messages?: { Subject: string; Created: string }[] };
    const nuevo = messages.find((m) => new Date(m.Created).getTime() >= despues.getTime() - 1000);
    const codigo = nuevo && /(\d{6})/.exec(nuevo.Subject)?.[1];
    if (codigo) return codigo;
    await new Promise((listo) => setTimeout(listo, 250));
  }
  throw new Error(`Sin codigo de verificacion para ${destino} en Mailpit`);
}

/**
 * Ingreso por la pantalla de login con el segundo paso por correo (equipo, y
 * pacientes que lo activaron). Si la cuenta entrega codigos de respaldo (primer
 * ingreso) los confirma. Devuelve cuando la URL es la de la zona.
 */
export async function ingresar(page: Page, usuario: string, zona: 'admin' | 'portal' = 'admin') {
  await page.goto('/ingreso');
  if (zona === 'admin') await page.getByRole('link', { name: 'Ingresar como profesional' }).click();
  await page.getByLabel('Correo o RUT').fill(correo(usuario));
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  const antes = new Date();
  await page.getByRole('button', { name: zona === 'admin' ? 'Entrar al panel' : 'Entrar a mi cuenta' }).click();
  const codigo = page.getByLabel('Código de verificación');
  await Promise.race([codigo.waitFor(), page.waitForURL(new RegExp(`/${zona}$`))]);
  if (await codigo.isVisible()) {
    await codigo.fill(await codigoCorreo(correo(usuario), antes));
    await page.getByRole('button', { name: 'Verificar' }).click();
    const listo = page.getByRole('button', { name: 'Ya los guardé, continuar' });
    await Promise.race([listo.waitFor(), page.waitForURL(new RegExp(`/${zona}$`))]);
    if (await listo.isVisible()) await listo.click();
  }
  await expect(page).toHaveURL(new RegExp(`/${zona}$`));
}

/** Ingreso al panel del equipo (codigo por correo). */
export const ingresarEquipo = (page: Page, usuario: string) => ingresar(page, usuario, 'admin');

/**
 * 03b-6: SQL de prueba contra la BD local (contenedor de docker compose dev),
 * para simular el paso del tiempo (p. ej. un plazo vencido) y para ubicar el
 * id de algo que la prueba creo por la UI. Nunca para preparar datos que la UI
 * deberia crear.
 */
export function sqlPrueba(sql: string): string {
  const contenedor = process.env.E2E_DB_CONTENEDOR ?? 'erp-centro-prueba-db-1';
  return execFileSync('docker', ['exec', contenedor, 'psql', '-U', 'vinculos_owner', '-d', 'app', '-tAc', sql], { encoding: 'utf8' }).trim();
}

const MAILPIT_API = `${MAILPIT}/api/v1`;
export const correoNuevo = (etiqueta: string) => `e2e.${etiqueta}.${Date.now()}@ejemplo.cl`;

/** Enlace (ruta con ?token=) del ultimo correo enviado a `para` que lleve `ruta` (espera hasta 15 s). */
export async function enlaceDelCorreo(para: string, ruta = '/pedir-hora/verificar'): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const r = (await (await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${para}"`)}`)).json()) as { messages: { ID: string }[] };
    // Del mas reciente al mas antiguo: el que lleva la ruta puede no ser el ultimo correo
    // (p. ej. el recordatorio llega antes que el aviso de cita confirmada).
    for (const { ID } of r.messages) {
      const m = (await (await fetch(`${MAILPIT_API}/message/${ID}`)).json()) as { Text: string };
      const url = new RegExp(`https?://\\S+${ruta}\\?token=[\\w-]+`).exec(m.Text)?.[0];
      if (url) return new URL(url).pathname + new URL(url).search;
    }
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error(`Sin correo con ${ruta} para ${para}`);
}

/** Selector propio (`ui/Selectores`: combobox + listbox, sin `<select>` nativo): abre y elige la opcion por su texto. */
export async function elegirOpcion(page: Page, nombre: string, opcion: string) {
  await page.getByRole('combobox', { name: nombre, exact: true }).click();
  await page.getByRole('listbox').getByRole('option', { name: opcion, exact: true }).click();
}

/** RUT valido al azar (con digito verificador) para pacientes de prueba. */
export function rutAlAzar(): string {
  const cuerpo = String(10_000_000 + Math.floor(Math.random() * 15_000_000));
  let suma = 0;
  for (let i = 0; i < cuerpo.length; i++) suma += Number(cuerpo[cuerpo.length - 1 - i]) * ((i % 6) + 2);
  const r = 11 - (suma % 11);
  return `${cuerpo}-${r === 11 ? '0' : r === 10 ? 'K' : String(r)}`;
}

/**
 * Desde /pedir-hora/<id>: primera hora libre, datos y envio. MVP sin COBROS:
 * sin paso de pago; la hora queda RETENIDA esperando que se verifique el
 * correo (cuenta regresiva de 30 minutos). Devuelve el correo usado.
 */
export async function pedirHora(page: Page, etiqueta: string, menor = false, rut?: string): Promise<string> {
  const email = correoNuevo(etiqueta);
  await page
    .getByRole('button', { name: /^\d{2}:\d{2}$/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Datos del paciente' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Nombre', exact: true }).fill('Prueba');
  await page.getByLabel('Apellido').fill('E2E');
  // 03b-4.1: tres desplegables (dia, mes, año), con el selector propio de la plataforma.
  await elegirOpcion(page, 'Día', '10');
  await elegirOpcion(page, 'Mes', 'mayo');
  await elegirOpcion(page, 'Año', menor ? '2012' : '1990');
  await page.getByLabel(/^Correo/).fill(email);
  // El RUT es obligatorio al pedir hora.
  await page.getByLabel(/^RUT/).fill(rut ?? rutAlAzar());
  // Sin match: el motivo en sus palabras (opcional; llega cifrado al tratante).
  await page.getByLabel('¿Qué te gustaría trabajar en la sesión?').fill('Me cuesta dormir hace unos meses.');
  if (menor) {
    await expect(page.getByText('Por la fecha de nacimiento, el paciente es menor de 18.', { exact: false })).toBeVisible();
    await page.getByLabel('Nombre completo').fill('Adulta Responsable');
    await page.getByLabel('Relación con el paciente').fill('Madre');
  }
  await page.getByRole('button', { name: 'Reservar mi hora' }).click();
  // Sin aceptar la politica no se envia.
  await expect(page.getByText('Para pedir hora debes aceptar la política de datos.')).toBeVisible();
  // La politica se lee en un modal, sin salir del formulario, y se acepta desde ahi.
  await page.getByRole('button', { name: 'política de datos personales' }).click();
  const documento = page.getByRole('dialog', { name: 'Política de datos personales' });
  await expect(documento.getByText(/^Versión \d+, vigente desde/)).toBeVisible();
  await documento.getByRole('button', { name: 'Leí y acepto' }).click();
  await expect(page).toHaveURL(/\/pedir-hora\//);
  await expect(page.getByLabel(/política de datos personales/)).toBeChecked();
  await page.getByLabel(/términos de agendamiento/).check();
  await page.getByRole('button', { name: 'Reservar mi hora' }).click();
  await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
  await expect(page.getByText(/^(29|30):\d{2}$/)).toBeVisible();
  return email;
}

/** Usuario del seed demo de cada profesional con perfil publico ("Uno" -> profesional1). */
const USUARIO_PROFESIONAL: Record<string, string> = {
  Uno: 'profesional1',
  Dos: 'profesional2',
  Tres: 'profesional3',
  Cuatro: 'profesional4',
  Cinco: 'profesional5',
  Seis: 'profesional6',
};

/**
 * MVP sin COBROS: el profesional de la cita aprueba la hora SOLICITADA desde
 * su agenda (detalle de la cita) y la cita queda CONFIRMADA. Abre su propio
 * contexto para no tocar la sesion de `page`.
 */
export async function aprobarHora(page: Page, citaId: string, profesional = 'Uno') {
  const contexto = await page.context().browser()!.newContext();
  const equipo = await contexto.newPage();
  await ingresarEquipo(equipo, USUARIO_PROFESIONAL[profesional]);
  await equipo.goto(`/admin/agenda?cita=${citaId}`);
  const detalle = equipo.getByRole('dialog');
  await expect(detalle.getByText('Hora por aprobar')).toBeVisible();
  await detalle.getByRole('button', { name: 'Aprobar' }).click();
  await expect.poll(() => sqlPrueba(`SELECT estado FROM citas WHERE id = '${citaId}'`)).toBe('CONFIRMADA');
  await contexto.close();
}

/** Cita de la reserva sin cuenta hecha con `email`. */
export const citaDeReserva = (email: string) => sqlPrueba(`SELECT cita_id FROM solicitudes_hora WHERE email = '${email}'`);

/**
 * 03b-6: paciente nuevo con ficha, sin tocar los del seed. MVP sin COBROS:
 * reserva, verificacion del correo (la solicitud pasa al profesional) y
 * aprobacion del profesional (cita CONFIRMADA). Devuelve su id.
 */
export async function pacienteNuevo(page: Page, etiqueta: string, profesional = 'Uno'): Promise<{ email: string; pacienteId: string }> {
  await page.goto('/equipo');
  await page.getByRole('link', { name: new RegExp(`Ver perfil completo de Ps\. Profesional ${profesional}`) }).click();
  await page.getByRole('link', { name: 'Ver horas disponibles' }).click();
  // Con RUT: la BD lo exige antes de la primera evolucion.
  const email = await pedirHora(page, etiqueta, false, rutAlAzar());
  await page.goto(await enlaceDelCorreo(email));
  await page.getByRole('button', { name: 'Confirmar mi hora' }).click();
  await expect(page.getByRole('heading', { name: 'Enviamos tu solicitud' })).toBeVisible();
  await aprobarHora(page, citaDeReserva(email), profesional);
  return { email, pacienteId: sqlPrueba(`SELECT paciente_id FROM solicitudes_hora WHERE email = '${email}'`) };
}
