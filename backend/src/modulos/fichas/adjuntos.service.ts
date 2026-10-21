import { randomUUID } from 'node:crypto';

import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { registrarAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { nombreArchivo, tipoPorContenido } from '../../core/validacion/archivos';

const VISTA = { id: true, pacienteId: true, subidoPorId: true, nombreArchivo: true, tipoMime: true, tamanoBytes: true, subidoEn: true } as const;

/**
 * Adjuntos externos de la ficha (02i). El archivo llega por multipart (multer
 * corta el stream al superar ADJUNTO_MAX_MB), se valida por contenido y se
 * guarda cifrado (DEK CLINICO, AAD adjuntos_ficha:contenido:<id>, id generado
 * aqui) como bytea. Subida y descarga quedan en accesos_ficha.
 *
 * ponytail: el archivo pasa por memoria (limite chico); con archivos grandes
 * o muchos, mover a almacenamiento de objetos (docs/api/integraciones.md).
 */
@Injectable()
export class AdjuntosService {
  constructor(private readonly bd: ContextoBd) {}

  async subir(pacienteId: string, archivo: Express.Multer.File) {
    const tipoMime = tipoPorContenido(archivo.buffer);
    if (!tipoMime) {
      throw new UnprocessableEntityException({ message: 'Solo PDF, PNG o JPEG (validado por contenido)', restriccion: 'adjuntos_ficha_tipo' });
    }
    const actor = this.bd.usuario();
    const tx = this.bd.tx();
    const nombre = nombreArchivo(archivo.originalname, 'adjunto');
    const adjunto = await tx.adjuntoFicha.create({
      data: {
        id: randomUUID(),
        pacienteId,
        subidoPorId: actor.id,
        nombreArchivo: nombre,
        tipoMime,
        tamanoBytes: archivo.size,
        contenido: claro(archivo.buffer.toString('base64')),
      },
      select: VISTA,
    });
    await registrarAcceso(tx, actor, [{ pacienteId, recurso: 'adjuntos_ficha', accion: 'ESCRITURA' }]);
    return adjunto;
  }

  listar(pacienteId: string) {
    return this.bd.tx().adjuntoFicha.findMany({ where: { pacienteId }, select: VISTA, orderBy: { subidoEn: 'desc' } });
  }

  async descargar(id: string) {
    const tx = this.bd.tx();
    const a = encontrado(await tx.adjuntoFicha.findUnique({ where: { id }, select: { ...VISTA, contenido: true } }), 'Adjunto');
    await registrarAcceso(tx, this.bd.usuario(), [{ pacienteId: a.pacienteId, recurso: 'adjuntos_ficha', accion: 'LECTURA' }]);
    return { nombreArchivo: a.nombreArchivo, tipoMime: a.tipoMime, contenido: Buffer.from(texto(a.contenido), 'base64') };
  }
}
