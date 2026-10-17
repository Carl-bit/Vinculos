/**
 * Respuestas del match para la solicitud de hora, solo en memoria de la
 * pestaña (pueden traer texto con contenido clinico: nunca localStorage,
 * sessionStorage ni la URL). Se pierden al recargar; la solicitud funciona
 * igual sin ellas. Se envian cifradas con la solicitud (D-6).
 */
type Respuestas = Record<string, string | string[]>;

let ultimo: { respuestas: Respuestas; recomendadoId: string | null } | null = null;

export function guardarMatch(respuestas: Respuestas, recomendadoId: string | null) {
  ultimo = { respuestas, recomendadoId };
}

export const ultimoMatch = () => ultimo;

export function olvidarMatch() {
  ultimo = null;
}
