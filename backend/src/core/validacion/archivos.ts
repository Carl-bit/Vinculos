/** Firmas (magic bytes) de los tipos permitidos: el tipo sale del contenido, nunca del cliente. */
const FIRMAS: { tipo: string; firma: number[] }[] = [
  { tipo: 'application/pdf', firma: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { tipo: 'image/png', firma: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { tipo: 'image/jpeg', firma: [0xff, 0xd8, 0xff] },
];

/** PDF, PNG o JPEG segun el contenido (adjuntos de la ficha, comprobantes de transferencia). */
export function tipoPorContenido(datos: Buffer): string | undefined {
  return FIRMAS.find((f) => datos.length >= f.firma.length && f.firma.every((b, i) => datos[i] === b))?.tipo;
}

/** Nombre de archivo seguro para guardar (sin ruta, utf8, maximo 200). */
export function nombreArchivo(original: string, porDefecto: string): string {
  const nombre = Buffer.from(original, 'latin1').toString('utf8').split(/[\\/]/).pop() ?? '';
  return nombre.slice(0, 200).trim() || porDefecto;
}
