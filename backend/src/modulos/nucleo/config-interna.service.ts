import { Injectable } from '@nestjs/common';
import type { ModuloCentro } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { ModulosGuard } from '../../core/modulos/modulos';
import type { ConfigInternaDto } from './dto/solicitudes-modulo.dto';

/**
 * R4 (Vinculos Control): aplicar una revision aprobada del manifiesto. La
 * regla vive en aplicar_config_interna() (token del silo, lista cerrada de
 * reglas, dependencias, nunca hacia atras); aqui solo se llama y se olvida la
 * cache de modulos para que el cambio rija de inmediato.
 */
@Injectable()
export class ConfigInternaService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly modulos: ModulosGuard,
  ) {}

  async aplicar(token: string, dto: ConfigInternaDto): Promise<{ resultado: 'APLICADA' | 'SIN_CAMBIOS'; revision: number; hash: string }> {
    const [{ resultado }] = await this.bd.sinContexto('interno').$queryRaw<[{ resultado: 'APLICADA' | 'SIN_CAMBIOS' }]>`
      SELECT aplicar_config_interna(${token}, ${dto.revision}::int, ${dto.hash}, ${dto.modulos}::modulo_centro[], ${JSON.stringify(dto.reglas)}::jsonb) AS resultado`;
    this.modulos.olvidar();
    return { resultado, revision: dto.revision, hash: dto.hash };
  }

  async leer(token: string): Promise<{ revision: number | null; hash: string | null; aplicadaEn: Date | null; modulos: ModuloCentro[] }> {
    const [f] = await this.bd.sinContexto('interno').$queryRaw<
      [{ revision: number | null; hash: string | null; aplicada_en: Date | null; modulos: ModuloCentro[] }]
    >`SELECT revision, hash, aplicada_en, modulos::text[] AS modulos FROM config_interna(${token})`;
    return { revision: f.revision, hash: f.hash, aplicadaEn: f.aplicada_en, modulos: f.modulos };
  }
}
