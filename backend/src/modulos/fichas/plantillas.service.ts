import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { type CampoPlantilla, erroresValores } from '../../common/plantillas-clinicas';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import type { EditarPlantillaClinicaDto, ListarPlantillasDto, ProponerPlantillaDto } from './dto/fichas.dto';

export const VISTA_PLANTILLA = {
  id: true,
  familiaId: true,
  especialidadId: true,
  tipo: true,
  nombre: true,
  version: true,
  estado: true,
  definicion: true,
  publicadaEn: true,
} satisfies Prisma.PlantillaClinicaSelect;

/**
 * Plantillas clinicas por especialidad (03a-2). Escritura solo via funciones
 * de la BD: proponer (ADMIN o PROFESIONAL con la especialidad aprobada),
 * editar un borrador, version nueva, publicar y desactivar (solo ADMIN). Una
 * version publicada es inmutable (trigger) y nunca se borra.
 */
@Injectable()
export class PlantillasService {
  constructor(private readonly bd: ContextoBd) {}

  listar(filtro: ListarPlantillasDto) {
    return this.bd.tx().plantillaClinica.findMany({
      where: filtro,
      select: VISTA_PLANTILLA,
      orderBy: [{ especialidadId: 'asc' }, { tipo: 'asc' }, { nombre: 'asc' }, { version: 'desc' }],
    });
  }

  async obtener(id: string) {
    return encontrado(await this.bd.tx().plantillaClinica.findUnique({ where: { id }, select: VISTA_PLANTILLA }), 'Plantilla');
  }

  async proponer(dto: ProponerPlantillaDto) {
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
      SELECT proponer_plantilla(${dto.especialidadId}::uuid, ${dto.tipo}::tipo_plantilla_clinica, ${dto.nombre},
                                ${JSON.stringify(dto.definicion)}::jsonb) AS id`;
    return this.obtener(id);
  }

  async editar(id: string, dto: EditarPlantillaClinicaDto) {
    await this.bd.tx().$executeRaw`
      SELECT editar_plantilla(${id}::uuid, ${dto.nombre ?? null}, ${dto.definicion ? JSON.stringify(dto.definicion) : null}::jsonb)`;
    return this.obtener(id);
  }

  async nuevaVersion(id: string) {
    const [{ nueva }] = await this.bd.tx().$queryRaw<[{ nueva: string }]>`SELECT nueva_version_plantilla(${id}::uuid) AS nueva`;
    return this.obtener(nueva);
  }

  async publicar(id: string) {
    await this.bd.tx().$executeRaw`SELECT publicar_plantilla(${id}::uuid)`;
    return this.obtener(id);
  }

  async desactivar(id: string) {
    await this.bd.tx().$executeRaw`SELECT desactivar_plantilla(${id}::uuid)`;
    return this.obtener(id);
  }

  /**
   * Valida los valores contra la version indicada y devuelve el JSON a
   * cifrar. 422 si la plantilla no existe para este usuario o los valores no
   * cumplen. Que la version este PUBLICADA y sea del tipo correcto lo exige la BD.
   */
  async valoresValidos(plantillaId: string, valores: Record<string, unknown>, exigirObligatorios = true): Promise<string> {
    const p = await this.bd.tx().plantillaClinica.findUnique({ where: { id: plantillaId }, select: { definicion: true } });
    if (!p) {
      throw new UnprocessableEntityException({ message: 'Plantilla inexistente', restriccion: 'registro_plantilla_valida' });
    }
    const errores = erroresValores(p.definicion as unknown as CampoPlantilla[], valores, exigirObligatorios);
    if (errores.length) {
      throw new UnprocessableEntityException({ message: 'Los valores no cumplen la plantilla', restriccion: 'registro_plantilla_valida', errores });
    }
    return JSON.stringify(valores);
  }
}
