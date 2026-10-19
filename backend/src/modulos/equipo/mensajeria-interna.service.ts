import { randomUUID } from 'node:crypto';

import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { TipoHiloInterno } from '@prisma/client';

import { registrarAcceso, type AccionAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import type { CrearHiloDto, ListarHilosDto } from './dto/mensajeria-interna.dto';

/** Mensajes por usuario y minuto (rate limit propio: el throttler global es por IP). */
const MENSAJES_POR_MINUTO = 30;

const VISTA_HILO = { id: true, tipo: true, asunto: true, pacienteId: true, creadoPorId: true, creadoEn: true, ultimoMensajeEn: true } as const;

type Hilo = { id: string; tipo: TipoHiloInterno; asunto: Uint8Array; pacienteId: string | null };

/**
 * Mensajeria interna del equipo (03a-2). No es el expediente: toda decision
 * clinica se registra en una evolucion.
 *
 * - GENERAL: coordinacion sin paciente, con participantes explicitos del
 *   equipo (no se nombra a pacientes).
 * - CASO: vinculado a un paciente; lo ve quien tiene acceso clinico vigente
 *   (tratante o acceso temporal) segun el rol activo. ADMIN, GESTION y la
 *   supervision no. La BD lo verifica en cada consulta (hilo_visible): quien
 *   pierde el acceso deja de ver el hilo al instante. Leer o escribir un hilo
 *   CASO se audita en accesos_ficha.
 *
 * Sin edicion; el autor retira un mensaje dentro de 5 minutos. Nombres via
 * nombres_hilo() ("Ex integrante del equipo" si la cuenta se cerro).
 */
@Injectable()
export class MensajeriaInternaService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  async crearHilo(dto: CrearHiloDto) {
    const id = randomUUID();
    const asunto = this.llavero.cifrarCampo(dto.asunto, 'hilos_internos', 'asunto', id);
    await this.bd.tx().$executeRaw`
      SELECT crear_hilo_interno(${id}::uuid, ${dto.tipo}::tipo_hilo_interno, ${asunto},
                                ${dto.tipo === 'CASO' ? dto.pacienteId! : null}::uuid, ${dto.participantes ?? []}::uuid[])`;
    const hilo = await this.hilo(id);
    await this.auditar([hilo], 'ESCRITURA');
    return this.vistaHilo(hilo);
  }

  async hilos(filtro: ListarHilosDto) {
    const tx = this.bd.tx();
    const yo = this.bd.usuario().id;
    const filas = await tx.hiloInterno.findMany({
      where: filtro.pacienteId ? { pacienteId: filtro.pacienteId } : {},
      select: VISTA_HILO,
      orderBy: { ultimoMensajeEn: 'desc' },
      take: 200,
    });
    await this.auditar(filas, 'LECTURA');
    return Promise.all(
      filas.map(async (h) => {
        const lectura = await tx.lecturaHilo.findUnique({ where: { hiloId_usuarioId: { hiloId: h.id, usuarioId: yo } }, select: { leidoEn: true } });
        const noLeidos = await tx.mensajeInterno.count({
          where: { hiloId: h.id, autorId: { not: yo }, ...(lectura ? { creadoEn: { gt: lectura.leidoEn } } : {}) },
        });
        return { ...this.vistaHilo(h), noLeidos };
      }),
    );
  }

  /** Mensajes del hilo, quien leyo hasta cuando; registra la lectura propia. */
  async mensajes(hiloId: string) {
    const tx = this.bd.tx();
    const hilo = await this.hilo(hiloId);
    const [mensajes, lecturas, nombres] = await Promise.all([
      tx.mensajeInterno.findMany({ where: { hiloId }, orderBy: { creadoEn: 'asc' } }),
      tx.lecturaHilo.findMany({ where: { hiloId }, select: { usuarioId: true, leidoEn: true } }),
      tx.$queryRaw<{ usuario_id: string; nombre: string }[]>`SELECT usuario_id, nombre FROM nombres_hilo(${hiloId}::uuid)`,
    ]);
    const nombre = new Map(nombres.map((n) => [n.usuario_id, n.nombre]));
    await this.leer(hiloId);
    await this.auditar([hilo], 'LECTURA');
    return {
      hilo: this.vistaHilo(hilo),
      mensajes: mensajes.map((m) => ({
        id: m.id,
        autorId: m.autorId,
        autor: nombre.get(m.autorId) ?? 'Ex integrante del equipo',
        rolAutor: m.rolAutor,
        contenido: m.contenido ? texto(m.contenido) : null,
        retirado: m.retiradoEn !== null,
        creadoEn: m.creadoEn,
      })),
      lecturas: lecturas.map((l) => ({ ...l, nombre: nombre.get(l.usuarioId) ?? 'Ex integrante del equipo' })),
    };
  }

  async enviar(hiloId: string, contenido: string) {
    const tx = this.bd.tx();
    const actor = this.bd.usuario();
    const hilo = await this.hilo(hiloId);
    const recientes = await tx.mensajeInterno.count({ where: { autorId: actor.id, creadoEn: { gt: new Date(Date.now() - 60_000) } } });
    if (recientes >= MENSAJES_POR_MINUTO) {
      throw new HttpException('Demasiados mensajes: espere un minuto', HttpStatus.TOO_MANY_REQUESTS);
    }
    const m = await tx.mensajeInterno.create({
      data: { id: randomUUID(), hiloId, autorId: actor.id, rolAutor: actor.rol, contenido: claro(contenido) },
    });
    await this.leer(hiloId);
    await this.auditar([hilo], 'ESCRITURA');
    return { id: m.id, hiloId, autorId: m.autorId, rolAutor: m.rolAutor, contenido: texto(m.contenido), creadoEn: m.creadoEn };
  }

  /** Dentro de 5 minutos (si no, 409); queda "mensaje retirado". */
  async retirar(id: string) {
    await this.bd.tx().$executeRaw`SELECT retirar_mensaje_interno(${id}::uuid)`;
    return { id, retirado: true };
  }

  async agregarParticipantes(hiloId: string, participantes: string[]) {
    await this.bd.tx().$executeRaw`SELECT agregar_participantes_hilo(${hiloId}::uuid, ${participantes}::uuid[])`;
    return this.bd.tx().participanteHilo.findMany({ where: { hiloId }, select: { usuarioId: true, agregadoEn: true } });
  }

  private async hilo(id: string) {
    return encontrado(await this.bd.tx().hiloInterno.findUnique({ where: { id }, select: VISTA_HILO }), 'Hilo');
  }

  private vistaHilo<H extends Hilo>(h: H) {
    return { ...h, asunto: texto(h.asunto) };
  }

  private async leer(hiloId: string) {
    const usuarioId = this.bd.usuario().id;
    await this.bd.tx().lecturaHilo.upsert({
      where: { hiloId_usuarioId: { hiloId, usuarioId } },
      create: { hiloId, usuarioId },
      update: { leidoEn: new Date() },
      select: { hiloId: true },
    });
  }

  private async auditar(hilos: Hilo[], accion: AccionAcceso) {
    const casos = hilos.filter((h) => h.tipo === 'CASO' && h.pacienteId);
    await registrarAcceso(
      this.bd.tx(),
      this.bd.usuario(),
      casos.map((h) => ({ pacienteId: h.pacienteId!, recurso: 'mensajes_internos', accion })),
    );
  }
}
