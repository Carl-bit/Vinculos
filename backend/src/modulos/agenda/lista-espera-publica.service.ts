import { randomUUID } from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { hashToken, nuevoTokenCorreo } from '../../core/auth/tokens-correo';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { JobsService, type ResultadoJob } from '../../core/jobs/jobs.service';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import type { InscribirListaEsperaDto, InscripcionListaEspera, InscripcionVerificada } from './dto/lista-espera-publica.dto';

interface Aviso {
  id: string;
  email: string;
  profesional_id: string;
  profesional_nombre: string;
  expira_en: Date;
}

/**
 * Lista de espera publica (03b), sin cuenta y sin contexto RLS: todo via
 * funciones de la BD. Solo por profesional (por tipo de atencion queda
 * pendiente). No crea paciente ni ficha.
 *
 * 1. inscribir: guarda nombre, correo y telefono (cifrado con el id) y manda
 *    el enlace de verificacion. Respuesta siempre igual: no revela si el
 *    correo ya estaba inscrito (la BD no toca la fila existente y, sobre el
 *    limite por correo, no emite nada).
 * 2. verificar: activa la inscripcion por dias_lista_espera_publica y manda
 *    el correo de alta con el enlace de baja.
 * 3. job: cuando se libera una hora o el profesional aparta un bloque nuevo,
 *    la BD deja el aviso pendiente; aqui se manda (como maximo uno cada 12 h
 *    por inscripcion) con un enlace de baja nuevo, y se borran las vencidas.
 * Nunca se loguea el correo ni los enlaces.
 */
@Injectable()
export class ListaEsperaPublicaService {
  private readonly logger = new Logger('ListaEsperaPublica');

  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly correos: CorreosCuenta,
    private readonly jobs: JobsService,
    private readonly config: ConfigService,
  ) {}

  async inscribir(dto: InscribirListaEsperaDto): Promise<InscripcionListaEspera> {
    if (dto.sitioWeb) {
      // Bot: misma respuesta, sin efectos.
      this.logger.warn('Inscripcion descartada por la trampa para bots');
      return { verificacionEnviada: true, expiraEn: new Date(Date.now() + 24 * 3_600_000) };
    }
    const id = randomUUID();
    const telefono = dto.telefono ? this.llavero.cifrarCampo(dto.telefono, 'lista_espera_publica', 'telefono', id) : null;
    const { token, hash } = nuevoTokenCorreo();
    const [r] = await this.bd.sinContexto('publico').$queryRaw<[{ emitido: boolean; expira: Date }]>`
      SELECT * FROM inscribir_lista_espera_publica(
        ${id}::uuid, ${dto.profesionalId}::uuid, ${dto.nombre}, ${dto.email}, ${telefono}, ${dto.politicaId}::uuid, ${hash})`;
    if (r.emitido) {
      await this.correos.enviar('VERIFICACION_LISTA_ESPERA', dto.email, token, r.expira);
    }
    return { verificacionEnviada: true, expiraEn: r.expira };
  }

  async verificar(token: string): Promise<InscripcionVerificada> {
    const baja = nuevoTokenCorreo();
    const [r] = await this.bd.sinContexto('publico').$queryRaw<
      { email: string; profesional_id: string; expira_en: Date }[]
    >`SELECT email, profesional_id, expira_en FROM verificar_lista_espera_publica(${hashToken(token)}, ${baja.hash})`;
    if (!r) {
      throw new NotFoundException('Enlace inexistente, usado o vencido: inscribase de nuevo');
    }
    await this.correos.enviar('ALTA_LISTA_ESPERA', r.email, baja.token, r.expira_en);
    return { expiraEn: r.expira_en, profesionalId: r.profesional_id };
  }

  async baja(token: string): Promise<void> {
    await this.bd.sinContexto('publico').$executeRaw`SELECT baja_lista_espera_publica(${hashToken(token)})`;
  }

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'avisar_lista_espera_publica' })
  async avisar(): Promise<ResultadoJob> {
    const base = this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
    const salientes: { aviso: Aviso; token: string }[] = [];
    const resultado = await this.jobs.conLock('avisar_lista_espera_publica', async (tx) => {
      const avisos = await tx.$queryRaw<Aviso[]>`SELECT * FROM avisos_lista_espera_publica(100)`;
      for (const aviso of avisos) {
        const baja = nuevoTokenCorreo();
        await tx.$executeRaw`SELECT token_baja_lista_espera(${aviso.id}::uuid, ${baja.hash})`;
        salientes.push({ aviso, token: baja.token });
      }
      await tx.$queryRaw`SELECT limpiar_lista_espera_publica()`;
      return avisos.length;
    });
    // Despues del COMMIT: si un envio falla, CorreosCuenta lo deja para reintento.
    for (const { aviso, token } of salientes) {
      const previo = `Hay horas disponibles con ${aviso.profesional_nombre}. Pida la suya aquí: ${base}/pedir-hora/${aviso.profesional_id}`;
      await this.correos.enviar('AVISO_LISTA_ESPERA', aviso.email, token, aviso.expira_en, previo);
    }
    return resultado;
  }
}
