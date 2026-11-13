/**
 * Estilo visual del silo (build arg NEXT_PUBLIC_TEMA). Los tokens de cada tema
 * cuelgan de :root[data-tema] (app/temas/); los componentes solo lo consultan
 * cuando el tema cambia el marcado, no solo el color (tapas del Cuaderno).
 * ponytail: fijo al compilar; pasa a runtime con Vinculos Control (configuracion_centro).
 */
export type Tema = 'moderno' | 'cuaderno';

export const TEMA: Tema = process.env.NEXT_PUBLIC_TEMA === 'cuaderno' ? 'cuaderno' : 'moderno';

export const esCuaderno = TEMA === 'cuaderno';
