/** Formatos de Chile: fechas en America/Santiago, montos en CLP, RUT con digito verificador. */

const ZONA = 'America/Santiago';

const fechaLarga = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' });
const fechaHora = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, dateStyle: 'medium', timeStyle: 'short' });
const hora = new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const clp = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

export const formatoFechaLarga = (d: Date | string) => fechaLarga.format(new Date(d));
export const formatoFechaHora = (d: Date | string) => fechaHora.format(new Date(d));
export const formatoHora = (d: Date | string) => hora.format(new Date(d));
export const formatoClp = (monto: number) => clp.format(monto);

/** Digito verificador (modulo 11) del cuerpo del RUT. */
function dv(cuerpo: string): string {
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
}

const limpiar = (rut: string) => rut.replace(/[.\s-]/g, '').toUpperCase();

export function rutValido(rut: string): boolean {
  const r = limpiar(rut);
  if (!/^\d{7,8}[\dK]$/.test(r)) return false;
  return dv(r.slice(0, -1)) === r.slice(-1);
}

/** 12345678K -> 12.345.678-K (sin validar). */
export function formatoRut(rut: string): string {
  const r = limpiar(rut);
  if (r.length < 2) return r;
  return `${r.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${r.slice(-1)}`;
}

/** Un identificador de login con forma de RUT (sin @). */
export const pareceRut = (texto: string) => !texto.includes('@') && /^[\d.\s-]+[\dkK]$/.test(texto.trim());
