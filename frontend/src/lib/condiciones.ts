/**
 * Condiciones de agendamiento generadas desde la configuracion del centro
 * (publico/centro), no texto fijo (brechas.md 1.5). MVP sin COBROS
 * (2026-11-11): sin cargos ni a quien se paga; solo el aviso para cancelar.
 */
import type { components } from './api/esquema';

type Centro = Pick<components['schemas']['CentroPublico'], 'plazo_aviso_cancelacion_horas'>;

export function condicionesAgendamiento(c: Centro, menor: boolean): string[] {
  const horas = c.plazo_aviso_cancelacion_horas;
  const lista = [
    `Puedes cancelar o cambiar la hora hasta ${horas} ${horas === 1 ? 'hora' : 'horas'} antes.`,
    'Si necesitas cancelar con menos aviso, avísanos apenas sepas: así la hora queda para otra persona.',
  ];
  if (menor) lista.push('Un adulto responsable debe acompañar al paciente en la primera sesión.');
  return lista;
}

/** Edad cumplida en una fecha (la BD la calcula con la fecha de la cita en Chile). */
export function edadEn(fechaNacimiento: string, fecha: Date = new Date()): number {
  const [a, m, d] = fechaNacimiento.slice(0, 10).split('-').map(Number) as [number, number, number];
  const [fa, fm, fd] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago' }).format(fecha).split('-').map(Number) as [number, number, number];
  return fa - a - (fm < m || (fm === m && fd < d) ? 1 : 0);
}
