import { Injectable } from '@nestjs/common';
import type { Modalidad, ModalidadAtencion } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import type { MatchDto } from './dto/match.dto';

export interface TarifaPublica {
  tipo_atencion: string | null;
  modalidad: ModalidadAtencion | null;
  monto: number;
}

export interface PerfilPublico {
  id: string;
  nombre_publico: string | null;
  bio: string | null;
  foto_url: string | null;
  especialidad: string;
  enfoques: string[];
  modalidad: Modalidad;
  tipos_atencion: string[];
  verificado: boolean;
  titulos_verificados: string[];
  tarifas: TarifaPublica[];
}

export interface Hueco {
  modalidad: ModalidadAtencion;
  inicio: Date;
  fin: Date;
}

const DIA = 86_400_000;

/**
 * Portal publico (sin autenticacion, sin contexto RLS: funciones diseñadas
 * para eso) y Match terapeutico. Nunca RUT, datos bancarios ni contacto.
 */
@Injectable()
export class MatchService {
  constructor(private readonly bd: ContextoBd) {}

  perfiles(): Promise<PerfilPublico[]> {
    return this.bd.sinContexto('publico').$queryRaw<PerfilPublico[]>`SELECT * FROM perfiles_publicos()`;
  }

  /** Sin contexto solo responde para perfiles publicos (la funcion lo filtra). Max. 62 dias. */
  disponibilidad(profesionalId: string, desde: Date, hasta: Date): Promise<Hueco[]> {
    return this.bd.sinContexto('publico').$queryRaw<Hueco[]>`
      SELECT modalidad, inicio, fin FROM disponibilidad_publica(${profesionalId}::uuid, ${desde}, ${hasta})`;
  }

  /**
   * Orden de prioridad: necesidad > tiempos > precio.
   * - Necesidad (tipo de atencion y modalidad): filtro estricto; no se
   *   ofrece a quien no atiende lo que el paciente necesita.
   * - Tiempos: primero quienes tienen huecos en el rango, por el mas cercano.
   * - Precio: dentro de cada grupo, primero quienes caben en la tarifa maxima.
   * Tiempos y precio ordenan (y se informan como cumpleTiempos/cumplePrecio),
   * no excluyen: un paciente puede preferir esperar o pagar algo mas.
   */
  async match(dto: MatchDto) {
    const desde = dto.desde ?? new Date();
    const hasta = dto.hasta ?? new Date(desde.getTime() + 14 * DIA);
    const candidatos = (await this.perfiles()).filter(
      (p) => (!dto.tipoAtencion || p.tipos_atencion.includes(dto.tipoAtencion)) && (!dto.modalidad || p.modalidad === 'MIXTA' || p.modalidad === dto.modalidad),
    );
    const resultados = await Promise.all(
      candidatos.map(async (p) => {
        const huecos = (await this.disponibilidad(p.id, desde, hasta)).filter((h) => !dto.modalidad || h.modalidad === dto.modalidad);
        const tarifa = tarifaAplicable(p.tarifas, dto.tipoAtencion, dto.modalidad);
        return {
          perfil: p,
          tarifa,
          primerHueco: huecos[0]?.inicio ?? null,
          cumpleTiempos: huecos.length > 0,
          cumplePrecio: dto.tarifaMaxima === undefined || (tarifa !== null && tarifa <= dto.tarifaMaxima),
        };
      }),
    );
    return resultados.sort(
      (a, b) =>
        Number(b.cumpleTiempos) - Number(a.cumpleTiempos) ||
        (a.primerHueco?.getTime() ?? Infinity) - (b.primerHueco?.getTime() ?? Infinity) ||
        Number(b.cumplePrecio) - Number(a.cumplePrecio) ||
        (a.tarifa ?? Infinity) - (b.tarifa ?? Infinity),
    );
  }
}

/** La tarifa mas especifica vigente: tipo+modalidad, tipo, modalidad, general. */
export function tarifaAplicable(tarifas: TarifaPublica[], tipo?: string, modalidad?: ModalidadAtencion): number | null {
  const buscar = (t: string | null, m: ModalidadAtencion | null) => tarifas.find((x) => x.tipo_atencion === t && x.modalidad === m)?.monto;
  return (
    (tipo && modalidad ? buscar(tipo, modalidad) : undefined) ??
    (tipo ? buscar(tipo, null) : undefined) ??
    (modalidad ? buscar(null, modalidad) : undefined) ??
    buscar(null, null) ??
    null
  );
}
