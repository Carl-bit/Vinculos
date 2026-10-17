/**
 * Condiciones de agendamiento generadas desde la configuracion del centro
 * (publico/centro), no texto fijo: el diseño decia "cobro completo" aunque el
 * centro tenga los porcentajes en 0 (brechas.md 1.5).
 */
import type { components } from './api/esquema';

type Centro = Pick<
  components['schemas']['CentroPublico'],
  'plazo_aviso_cancelacion_horas' | 'penalizacion_cancelacion_porcentaje' | 'cobro_inasistencia_porcentaje' | 'modelo_cobro'
>;

const pct = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })} %`;

export function condicionesAgendamiento(c: Centro, menor: boolean): string[] {
  const horas = c.plazo_aviso_cancelacion_horas;
  const lista = [`Puedes cancelar o cambiar la hora sin costo hasta ${horas} ${horas === 1 ? 'hora' : 'horas'} antes.`];
  lista.push(
    c.penalizacion_cancelacion_porcentaje > 0
      ? `Si cancelas con menos de ${horas} horas de aviso, se cobra el ${pct(c.penalizacion_cancelacion_porcentaje)} del valor de la sesión.`
      : 'Cancelar con menos aviso no tiene cobro, pero libera la hora para otra persona: avísanos apenas sepas.',
  );
  if (c.cobro_inasistencia_porcentaje > 0) {
    lista.push(`Si no llegas sin avisar, se cobra el ${pct(c.cobro_inasistencia_porcentaje)} del valor de la sesión.`);
  }
  lista.push(
    c.modelo_cobro === 'CENTRO'
      ? 'La sesión se paga al centro.'
      : c.modelo_cobro === 'DIRECTO'
        ? 'La sesión se paga directamente al profesional.'
        : 'El centro te indica al confirmar si la sesión se paga al centro o al profesional.',
  );
  if (menor) lista.push('Un adulto responsable debe acompañar al paciente en la primera sesión.');
  return lista;
}

/** Edad cumplida en una fecha (la BD la calcula con la fecha de la cita en Chile). */
export function edadEn(fechaNacimiento: string, fecha: Date): number {
  const [a, m, d] = fechaNacimiento.split('-').map(Number) as [number, number, number];
  const [fa, fm, fd] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago' }).format(fecha).split('-').map(Number) as [number, number, number];
  return fa - a - (fm < m || (fm === m && fd < d) ? 1 : 0);
}
