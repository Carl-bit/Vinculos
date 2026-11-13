import { Injectable } from '@nestjs/common';

import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import type { AutorizacionSoporteVista, OtorgarSoporteDto, RegistroSoporteVista } from './dto/nucleo.dto';

/**
 * AUD-01 (E2.1): el centro (ADMIN) autoriza al soporte de Vinculos por un
 * plazo (maximo 72 h) y alcance; ve cada diagnostico que se ejecuto. El
 * soporte usa un rol de BD sin acceso a tablas (docs/cumplimiento/soporte.md);
 * la API solo administra las autorizaciones y muestra el registro.
 */
@Injectable()
export class SoporteService {
  constructor(private readonly bd: ContextoBd) {}

  async autorizaciones(): Promise<AutorizacionSoporteVista[]> {
    const tx = this.bd.tx();
    const [filas, nombres] = await Promise.all([
      tx.autorizacionSoporte.findMany({ orderBy: { desde: 'desc' }, take: 50, include: { _count: { select: { registros: true } } } }),
      this.nombres(),
    ]);
    const ahora = Date.now();
    return filas.map((a) => ({
      id: a.id,
      motivo: a.motivo,
      alcance: a.alcance,
      desde: a.desde,
      hasta: a.hasta,
      vigente: !a.revocadaEn && a.desde.getTime() <= ahora && a.hasta.getTime() > ahora,
      otorgadaPor: nombres.get(a.otorgadaPorId) ?? null,
      revocadaEn: a.revocadaEn,
      revocadaPor: a.revocadaPorId ? (nombres.get(a.revocadaPorId) ?? null) : null,
      usos: a._count.registros,
    }));
  }

  async otorgar(dto: OtorgarSoporteDto): Promise<AutorizacionSoporteVista> {
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
      SELECT otorgar_soporte(${dto.motivo}, ${dto.alcance}::alcance_soporte, ${dto.horas}::int) AS id`;
    return encontrado(
      (await this.autorizaciones()).find((a) => a.id === id),
      'Autorizacion',
    );
  }

  async revocar(id: string): Promise<AutorizacionSoporteVista> {
    await this.bd.tx().$executeRaw`SELECT revocar_soporte(${id}::uuid)`;
    return encontrado(
      (await this.autorizaciones()).find((a) => a.id === id),
      'Autorizacion',
    );
  }

  registro(): Promise<RegistroSoporteVista[]> {
    return this.bd.tx().registroSoporte.findMany({
      orderBy: { ocurridoEn: 'desc' },
      take: 200,
      select: { id: true, autorizacionId: true, funcion: true, rolBd: true, ocurridoEn: true },
    });
  }

  private async nombres(): Promise<Map<string, string | null>> {
    const filas = await this.bd.tx().$queryRaw<{ id: string; nombre: string | null }[]>`SELECT id, nombre FROM directorio_interno()`;
    return new Map(filas.map((f) => [f.id, f.nombre]));
  }
}
