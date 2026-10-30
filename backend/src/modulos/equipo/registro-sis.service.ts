import { Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { ErrorVerificador, SinRutParaVerificar, VerificadorPrestadores, verificarRegistrosSis } from '../../core/integraciones/verificador-prestadores';
import type { VerificacionManualSisDto } from './dto/equipo.dto';
import type { RegistroSisVista } from './dto/equipo-respuestas.dto';

/**
 * Registro en la Superintendencia de Salud (03b-4.2). El profesional informa
 * su numero; se verifica contra el RNPI desde el servidor (al informarlo, a
 * pedido del ADMIN y en el job mensual) o a mano por el ADMIN.
 */
@Injectable()
export class RegistroSisService {
  private readonly logger = new Logger('RegistroSis');

  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly verificador: VerificadorPrestadores,
  ) {}

  async ver(profesionalId: string, motivo?: string | null): Promise<RegistroSisVista> {
    const r = await this.bd.tx().registroSis.findUnique({ where: { profesionalId } });
    const base = { verificacionSimulada: this.verificador.simulado, ...(motivo !== undefined ? { motivo } : {}) };
    if (!r) return { estado: 'NO_INFORMADO', numero: null, metodo: null, tituloHabilitante: null, institucion: null, verificadoEn: null, ...base };
    return {
      estado: r.estado as RegistroSisVista['estado'],
      numero: r.numero,
      metodo: r.metodo as RegistroSisVista['metodo'],
      tituloHabilitante: r.tituloHabilitante,
      institucion: r.institucion,
      verificadoEn: r.verificadoEn,
      ...base,
    };
  }

  /** El profesional informa (o quita) su numero; se intenta verificar en el acto (si el RNPI falla, queda PENDIENTE). */
  async informar(numero: string | null): Promise<RegistroSisVista> {
    const yo = this.bd.usuario().id;
    await this.bd.tx().$executeRaw`SELECT informar_registro_sis(${numero})`;
    if (numero === null) return this.ver(yo);
    try {
      const { resultados } = await verificarRegistrosSis(this.bd.tx(), this.llavero, this.verificador, yo);
      return this.ver(yo, resultados[0]?.motivo ?? null);
    } catch (e) {
      if (e instanceof SinRutParaVerificar) return this.ver(yo, 'Falta tu RUT en datos privados: sin él no se puede comparar con el registro.');
      if (e instanceof ErrorVerificador) {
        this.logger.warn(`verificacion RNPI no disponible (${e.motivo})`);
        return this.ver(yo, 'El registro de prestadores no respondió: queda pendiente.');
      }
      throw e;
    }
  }

  /** ADMIN: verificacion automatica a pedido. */
  async verificar(profesionalId: string): Promise<RegistroSisVista> {
    let motivo: string | null;
    try {
      const { resultados } = await verificarRegistrosSis(this.bd.tx(), this.llavero, this.verificador, profesionalId);
      if (resultados.length === 0) throw new UnprocessableEntityException('El profesional no tiene registro informado');
      motivo = resultados[0].motivo;
    } catch (e) {
      if (e instanceof SinRutParaVerificar) {
        throw new UnprocessableEntityException('Falta el RUT del profesional en sus datos privados: verifica a mano o pídeselo.');
      }
      if (e instanceof ErrorVerificador) {
        this.logger.warn(`verificacion RNPI no disponible (${e.motivo})`);
        throw new ServiceUnavailableException(
          e.motivo === 'LIMITE'
            ? 'Se alcanzó el límite de consultas a la Superintendencia. Intenta más tarde o verifica a mano.'
            : 'No se pudo consultar el registro de prestadores. Verifica a mano con el respaldo de la trayectoria.',
        );
      }
      throw e;
    }
    return this.ver(profesionalId, motivo);
  }

  /** ADMIN: verificacion manual con el respaldo de la trayectoria. */
  async verificarManual(profesionalId: string, dto: VerificacionManualSisDto): Promise<RegistroSisVista> {
    const tx = this.bd.tx();
    const r = await tx.registroSis.findUnique({ where: { profesionalId }, select: { numero: true } });
    if (!r) throw new UnprocessableEntityException('El profesional no tiene registro informado');
    const estado = dto.coincide ? 'VERIFICADO_MANUAL' : 'NO_COINCIDE';
    await tx.$executeRaw`SELECT registrar_verificacion_sis(${profesionalId}::uuid, ${r.numero}, ${estado}, 'MANUAL', ${dto.tituloHabilitante}, ${dto.institucion})`;
    return this.ver(profesionalId);
  }
}
