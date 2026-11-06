/**
 * Resumen del navegador para el registro de conexiones ("Chrome en Windows").
 * Solo navegador y sistema: nunca se guarda el User-Agent completo ni la IP
 * (docs/api/sesion_unica_conexiones.md). El orden importa: Edge y Opera dicen
 * "Chrome" y Chrome dice "Safari"; Android dice "Linux" e iOS "Mac OS X".
 */
const NAVEGADORES: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SISTEMAS: [RegExp, string][] = [
  [/Windows/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function resumirDispositivo(userAgent: string | undefined): string | null {
  if (!userAgent?.trim()) {
    return null;
  }
  const navegador = NAVEGADORES.find(([r]) => r.test(userAgent))?.[1] ?? 'Otro navegador';
  const sistema = SISTEMAS.find(([r]) => r.test(userAgent))?.[1];
  return sistema ? `${navegador} en ${sistema}` : navegador;
}
