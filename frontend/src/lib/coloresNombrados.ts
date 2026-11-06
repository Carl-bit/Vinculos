/**
 * Colores con nombre para quien no conoce el formato #RRGGBB (03c, Marca y
 * apariencia). Escribir "amarillo", "vainilla" o "terracota" muestra los tonos
 * que calzan, con su codigo. Catalogo: primarios, secundarios y sus variantes
 * con nombres clasicos de objetos (frutilla, oliva, ladrillo, marfil...).
 * Un tono que no se leeria bien en el campo se ofrece ajustado (mas oscuro
 * para el color principal, mas claro para el fondo) con las reglas de la BD.
 */
import { fondoValido, principalValido, TINTA } from './marca';

export interface ColorNombrado {
  nombre: string;
  hex: string;
  /** Familias para buscar ("amarillo", "cafe"...), sin tildes. */
  familias: string[];
}

/** [nombre, #RRGGBB, familias separadas por espacio] */
const DATOS: [string, string, string][] = [
  // Rojos
  ['Rojo', '#C62828', 'rojo'],
  ['Rojo ladrillo', '#9B2D20', 'rojo ladrillo'],
  ['Rojo carmín', '#A4161A', 'rojo carmin'],
  ['Escarlata', '#D0312D', 'rojo escarlata'],
  ['Cereza', '#9E1B32', 'rojo cereza'],
  ['Frutilla', '#D9434F', 'rojo frutilla fresa rosado'],
  ['Tomate', '#D94A2B', 'rojo tomate naranjo'],
  ['Granate', '#7B1E2B', 'rojo granate burdeo'],
  ['Rojo vino', '#7A1F2B', 'rojo vino burdeo'],
  ['Burdeo', '#6D1A2B', 'burdeo rojo vino'],
  ['Rojo pálido', '#F8E4E1', 'rojo'],
  // Naranjos
  ['Naranjo', '#E67E22', 'naranjo naranja'],
  ['Mandarina', '#F28C28', 'naranjo naranja mandarina'],
  ['Calabaza', '#D35400', 'naranjo naranja calabaza zapallo'],
  ['Naranjo quemado', '#A6461A', 'naranjo naranja quemado'],
  ['Terracota', '#9C4A24', 'naranjo naranja terracota cafe'],
  ['Arcilla', '#8A4B1F', 'naranjo naranja arcilla cafe marron'],
  ['Óxido', '#8B3A1A', 'naranjo oxido cafe rojo'],
  ['Cobre', '#B0602F', 'naranjo cobre metal'],
  ['Coral', '#E8735A', 'naranjo coral rosado'],
  ['Salmón', '#F29E86', 'naranjo salmon rosado'],
  ['Durazno', '#F6C3A1', 'naranjo durazno damasco'],
  ['Damasco', '#F4B183', 'naranjo damasco durazno'],
  ['Naranjo pálido', '#FBE8D8', 'naranjo naranja'],
  // Amarillos y dorados
  ['Amarillo', '#F2C500', 'amarillo'],
  ['Limón', '#F4E04D', 'amarillo limon'],
  ['Canario', '#FFE14D', 'amarillo canario'],
  ['Maíz', '#F3C74E', 'amarillo maiz choclo'],
  ['Mostaza', '#C9A227', 'amarillo mostaza'],
  ['Mostaza oscuro', '#6E5200', 'amarillo mostaza'],
  ['Ocre', '#B8860B', 'amarillo ocre dorado cafe'],
  ['Ocre oscuro', '#735410', 'amarillo ocre dorado'],
  ['Oro', '#B8912A', 'amarillo oro dorado metal'],
  ['Ámbar', '#E0A526', 'amarillo ambar naranjo'],
  ['Miel', '#D9A441', 'amarillo miel dorado'],
  ['Vainilla', '#F3E5AB', 'amarillo vainilla crema'],
  ['Amarillo pálido', '#FBF3D5', 'amarillo'],
  ['Amarillo crema', '#F8F0DC', 'amarillo crema'],
  // Verdes
  ['Verde', '#2E7D32', 'verde'],
  ['Verde oliva', '#4F6B2F', 'verde oliva'],
  ['Aceituna', '#5B5B1F', 'verde aceituna oliva'],
  ['Musgo', '#5A6B2E', 'verde musgo'],
  ['Verde bosque', '#2E5C3A', 'verde bosque'],
  ['Pino', '#1F4D3A', 'verde pino'],
  ['Verde botella', '#1E4D2B', 'verde botella'],
  ['Esmeralda', '#1F6B4F', 'verde esmeralda'],
  ['Jade', '#00A86B', 'verde jade'],
  ['Lima', '#9BC53D', 'verde lima limon amarillo'],
  ['Pistacho', '#B7CF8A', 'verde pistacho'],
  ['Menta', '#A8DCC0', 'verde menta'],
  ['Salvia', '#9CAF88', 'verde salvia gris'],
  ['Verde salvia claro', '#E7EEDF', 'verde salvia'],
  ['Verde menta pálido', '#E3F2EA', 'verde menta'],
  // Turquesas y celestes
  ['Turquesa', '#30B3A8', 'turquesa celeste verde azul'],
  ['Turquesa oscuro', '#1B6663', 'turquesa verde azul'],
  ['Aguamarina', '#7FD1C3', 'turquesa aguamarina celeste'],
  ['Petróleo', '#1D5C63', 'azul petroleo verde turquesa'],
  ['Celeste', '#5DADE2', 'celeste azul cielo'],
  ['Celeste profundo', '#1E5F7A', 'celeste azul'],
  ['Cielo', '#A9D6F5', 'celeste azul cielo'],
  ['Celeste pálido', '#E2F1F7', 'celeste azul'],
  // Azules
  ['Azul', '#1F5FAD', 'azul'],
  ['Azul océano', '#2F5A7A', 'azul oceano mar'],
  ['Azul marino', '#1F3A5F', 'azul marino'],
  ['Azul rey', '#2A4DA8', 'azul rey'],
  ['Cobalto', '#1F4FA0', 'azul cobalto'],
  ['Zafiro', '#1C3F8C', 'azul zafiro'],
  ['Índigo', '#34407A', 'azul indigo morado'],
  ['Mezclilla', '#4A6A8F', 'azul mezclilla jeans'],
  ['Acero', '#4E6E8E', 'azul acero gris metal'],
  ['Azul cielo pálido', '#E4EEF6', 'azul cielo celeste'],
  ['Azul niebla', '#EEF2F4', 'azul gris niebla'],
  // Morados
  ['Morado', '#6A3D9A', 'morado violeta'],
  ['Violeta', '#5E3A8C', 'violeta morado lila'],
  ['Ciruela', '#6B3A5C', 'morado ciruela violeta'],
  ['Uva', '#5B2D6E', 'morado uva violeta'],
  ['Berenjena', '#4B2A43', 'morado berenjena'],
  ['Magenta', '#B0307A', 'morado magenta rosado fucsia'],
  ['Lila', '#C8A2C8', 'lila morado violeta'],
  ['Lavanda', '#B9A7D6', 'lavanda lila morado violeta'],
  ['Lavanda pálida', '#EEE8F3', 'morado lavanda lila violeta'],
  ['Lila pálido', '#F1E9F5', 'lila morado violeta'],
  // Rosados
  ['Rosado', '#E0789B', 'rosado rosa'],
  ['Fucsia', '#C2185B', 'rosado rosa fucsia magenta'],
  ['Frambuesa', '#9C2F5A', 'rosado rosa frambuesa rojo'],
  ['Rosado viejo', '#8E4B5E', 'rosado rosa viejo'],
  ['Palo rosa', '#D8A7A7', 'rosado rosa palo'],
  ['Chicle', '#F49AC2', 'rosado rosa chicle'],
  ['Rosado pálido', '#F8E6EC', 'rosado rosa'],
  // Cafés
  ['Café', '#6F4E37', 'cafe marron'],
  ['Chocolate', '#5C3A21', 'cafe marron chocolate'],
  ['Canela', '#A0663B', 'cafe marron canela naranjo'],
  ['Caramelo', '#AF6E30', 'cafe marron caramelo naranjo'],
  ['Avellana', '#7A5233', 'cafe marron avellana'],
  ['Nuez', '#5D4130', 'cafe marron nuez'],
  ['Castaño', '#6B3F2A', 'cafe marron castano'],
  ['Moka', '#7B5B4A', 'cafe marron moka'],
  ['Café con leche', '#C8A989', 'cafe marron beige'],
  ['Café con leche claro', '#F2E7DA', 'cafe marron beige'],
  // Beige, crema y blancos
  ['Beige', '#E3D3B8', 'beige crema'],
  ['Arena', '#D8C3A0', 'beige arena crema'],
  ['Trigo', '#E8D3A6', 'beige trigo amarillo'],
  ['Beige arena', '#EFE6D6', 'beige arena crema'],
  ['Crema', '#F5EAD8', 'crema beige blanco'],
  ['Lienzo', '#F1EBE2', 'crema beige lienzo'],
  ['Marfil', '#FBF7EC', 'blanco marfil crema'],
  ['Blanco hueso', '#F7F3EA', 'blanco hueso crema'],
  ['Blanco papel', '#FFFDF9', 'blanco papel'],
  ['Blanco nieve', '#FFFFFF', 'blanco nieve'],
  // Grises y negros
  ['Gris', '#7A7A7A', 'gris'],
  ['Plata', '#B8B8B8', 'gris plata metal'],
  ['Humo', '#8A8A85', 'gris humo'],
  ['Gris grafito', '#3F4447', 'gris grafito'],
  ['Gris pizarra', '#4A5560', 'gris pizarra azul'],
  ['Gris perla', '#EEEEEC', 'gris perla blanco'],
  ['Gris niebla', '#F1F1EF', 'gris niebla'],
  ['Carbón', '#333333', 'negro gris carbon'],
  ['Negro tinta', '#2B2420', 'negro tinta'],
  ['Negro', '#1A1A1A', 'negro'],
];

export const COLORES_NOMBRADOS: ColorNombrado[] = DATOS.map(([nombre, hex, f]) => ({ nombre, hex, familias: f.split(' ') }));

/** Minusculas y sin tildes, para comparar lo que se escribe. */
export const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Colores cuyo nombre o familia calza con lo escrito ("amarillo", "vaini",
 * "café"). Desde 2 letras; primero los que empiezan con lo escrito.
 */
export function buscarColores(texto: string): ColorNombrado[] {
  const q = normalizar(texto);
  if (q.length < 2 || q.startsWith('#')) return [];
  const calza = (c: ColorNombrado) => {
    const n = normalizar(c.nombre);
    if (n.startsWith(q)) return 0;
    if (n.split(' ').some((p) => p.startsWith(q))) return 1;
    if (c.familias.some((f) => f.startsWith(q))) return 2;
    return n.includes(q) ? 3 : -1;
  };
  return COLORES_NOMBRADOS.map((c) => ({ c, r: calza(c) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.c);
}

/** Nombre del catalogo para un #RRGGBB, si lo tiene. */
export const nombreDeColor = (hex: string) => COLORES_NOMBRADOS.find((c) => c.hex === hex.toUpperCase())?.nombre;

const aHex = (n: number[]) => `#${n.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const canales = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * El tono tal cual si se lee bien en el campo; si no, la version mas cercana
 * que cumple: mezclado con negro (principal: >= 4.5:1 sobre crema) o con
 * blanco (fondo: la tinta a >= 10:1). Siempre existe: el negro y el blanco cumplen.
 * `cuanto` (0 a 1) es la mezcla aplicada.
 */
export function tonoLegible(hex: string, tipo: 'principal' | 'fondo'): { hex: string; ajustado: boolean; cuanto: number } {
  const valido = tipo === 'principal' ? principalValido : fondoValido;
  if (valido(hex)) return { hex, ajustado: false, cuanto: 0 };
  const destino = tipo === 'principal' ? 0 : 255;
  const base = canales(hex);
  for (let t = 0.04; t <= 1; t += 0.04) {
    const c = aHex(base.map((x) => x + (destino - x) * t));
    if (valido(c)) return { hex: c, ajustado: true, cuanto: t };
  }
  return { hex: tipo === 'principal' ? TINTA : '#FFFFFF', ajustado: true, cuanto: 1 };
}
