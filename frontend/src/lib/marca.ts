/**
 * Marca del centro por zona (03c). La cuenta madre elige el color principal y
 * el de fondo del sitio publico, del portal del paciente y del panel del
 * equipo; la BD exige el contraste (contenido_publico_colores) y esta copia lo
 * muestra antes de guardar. Las tarjetas siguen en crema.
 */
export type Zona = 'publico' | 'portal' | 'panel';

/** Nombre cuando ni la API ni el .env del silo lo entregan (R11). */
export const NOMBRE_RESPALDO = 'Centro';

export const CREMA = '#F5EAD8';
export const TINTA = '#2B2420';
/** Mismos minimos que la BD. */
export const MINIMO_PRINCIPAL = 4.5;
export const MINIMO_FONDO = 10;

/** Colores del sistema cuando el centro no eligio uno. */
export const SISTEMA: Record<Zona, { principal: string; fondo: string }> = {
  publico: { principal: '#8C491A', fondo: '#F1EBE2' },
  portal: { principal: '#515E3B', fondo: '#F1EBE2' },
  panel: { principal: '#8C491A', fondo: '#F1EBE2' },
};

const HEX = /^#[0-9a-fA-F]{6}$/;
export const esHex = (v: string | null | undefined): v is string => !!v && HEX.test(v);

function luminancia(hex: string): number {
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

/** Contraste WCAG 2.x (1 a 21), igual que contraste_wcag() en la BD. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const principalValido = (hex: string) => esHex(hex) && contraste(hex, CREMA) >= MINIMO_PRINCIPAL;
export const fondoValido = (hex: string) => esHex(hex) && contraste(hex, TINTA) >= MINIMO_FONDO;

/** Escala 100..900 derivada de un color (700 = el color), con color-mix en el navegador. */
function escala(prefijo: string, hex: string): string {
  const claro = { 100: 8, 200: 18, 300: 32, 400: 52, 500: 72, 600: 86 };
  const partes = Object.entries(claro).map(([n, p]) => `--color-${prefijo}-${n}:color-mix(in srgb,${hex} ${p}%,white)`);
  return [
    ...partes,
    `--color-${prefijo}-700:${hex}`,
    `--color-${prefijo}-800:color-mix(in srgb,${hex} 80%,black)`,
    `--color-${prefijo}-900:color-mix(in srgb,${hex} 55%,black)`,
  ].join(';');
}

/**
 * CSS que reemplaza los tokens de la zona. El principal es el color de las
 * acciones de cada zona: en el sitio publico y en el panel, la terracota
 * (accent y arcilla: "Pedir una hora", botones del equipo); en el portal, el
 * verde del paciente (accent-2 y oliva). Fondo: el lienzo con su trama de
 * puntos en las tres zonas (el sitio publico la usa desde el diseño "Moderno",
 * 2026-11-06). Solo emite colores #RRGGBB validos.
 */
export function cssMarca(zona: Zona, principal?: string | null, fondo?: string | null): string {
  const raiz: string[] = [];
  if (esHex(principal) && principalValido(principal)) {
    if (zona === 'portal') raiz.push(escala('accent-2', principal), `--color-oliva:${principal}`);
    else raiz.push(escala('accent', principal), `--color-arcilla:${principal}`);
  }
  if (esHex(fondo) && fondoValido(fondo)) raiz.push(`--color-lienzo:${fondo}`, `--color-punto:color-mix(in srgb,${fondo} 86%,${TINTA})`);
  return raiz.length ? `:root{${raiz.join(';')}}` : '';
}
