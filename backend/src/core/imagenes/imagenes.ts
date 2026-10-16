import { UnprocessableEntityException } from '@nestjs/common';
import sharp = require('sharp');

/** Entrada maxima de una imagen publica (multipart). La salida queda bajo 1 MB. */
export const IMAGEN_MAX_BYTES = 5 * 1024 * 1024;

const FIRMAS: number[][] = [
  [0xff, 0xd8, 0xff], // JPEG
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
];
const esWebp = (b: Buffer) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';

export interface ImagenProcesada {
  contenido: Buffer;
  tipoMime: 'image/webp';
  ancho: number;
  alto: number;
}

/**
 * Foto de perfil o logo (publicas, 03a): tipo validado por contenido (JPEG,
 * PNG o WebP; nunca por la extension ni el Content-Type), orientacion
 * aplicada, maximo 1024 px por lado y re-codificada a WebP sin metadatos
 * (sharp no copia EXIF/ICC/XMP salvo que se pida). Se guardan aparte de los
 * adjuntos clinicos.
 */
export async function procesarImagenPublica(datos: Buffer): Promise<ImagenProcesada> {
  const valida = esWebp(datos) || FIRMAS.some((f) => datos.length >= f.length && f.every((b, i) => datos[i] === b));
  if (!valida) {
    throw new UnprocessableEntityException({ message: 'Solo imagenes JPEG, PNG o WebP (validado por contenido)', restriccion: 'imagenes_publicas_tipo' });
  }
  try {
    const { data, info } = await sharp(datos, { limitInputPixels: 40_000_000, failOn: 'error' })
      .rotate()
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { contenido: data, tipoMime: 'image/webp', ancho: info.width, alto: info.height };
  } catch {
    throw new UnprocessableEntityException({ message: 'La imagen esta dañada o no se pudo procesar', restriccion: 'imagenes_publicas_tipo' });
  }
}
