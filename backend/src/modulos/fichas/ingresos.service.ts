import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { registrarAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import type { CrearIngresoDto } from './dto/fichas.dto';
import { PlantillasService, VISTA_PLANTILLA } from './plantillas.service';

const VISTA_INGRESO = {
  id: true,
  fichaClinicaId: true,
  autorId: true,
  valores: true,
  corrigeAId: true,
  createdAt: true,
  plantilla: { select: VISTA_PLANTILLA },
} satisfies Prisma.IngresoFichaSelect;

type Ingreso = Prisma.IngresoFichaGetPayload<{ select: typeof VISTA_INGRESO }>;

const vista = (i: Ingreso) => ({ ...i, valores: JSON.parse(texto(i.valores)) as Record<string, unknown> });

/**
 * Ficha de ingreso / anamnesis (03a-2): append-only como las evoluciones.
 * Escribe el tratante (o quien tiene acceso temporal de escritura) con una
 * plantilla INGRESO publicada de su especialidad; cada registro se muestra con
 * la version con que se escribio. Un tratante nuevo de otra especialidad
 * escribe su propio ingreso con su plantilla.
 */
@Injectable()
export class IngresosService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly plantillas: PlantillasService,
  ) {}

  private async ficha(fichaId: string) {
    return encontrado(await this.bd.tx().fichaClinica.findUnique({ where: { id: fichaId }, select: { id: true, pacienteId: true } }), 'Ficha');
  }

  async crear(fichaId: string, dto: CrearIngresoDto) {
    const tx = this.bd.tx();
    const ficha = await this.ficha(fichaId);
    const valores = await this.plantillas.valoresValidos(dto.plantillaId, dto.valores);
    const id = randomUUID();
    await tx.ingresoFicha.createMany({
      data: [
        { id, fichaClinicaId: ficha.id, autorId: this.bd.usuario().id, plantillaId: dto.plantillaId, valores: claro(valores), corrigeAId: dto.corrigeAId },
      ],
    });
    await registrarAcceso(tx, this.bd.usuario(), [{ pacienteId: ficha.pacienteId, fichaId: ficha.id, recurso: 'ingresos_ficha', accion: 'ESCRITURA' }]);
    return vista(await tx.ingresoFicha.findUniqueOrThrow({ where: { id }, select: VISTA_INGRESO }));
  }

  async listar(fichaId: string) {
    const tx = this.bd.tx();
    const ficha = await this.ficha(fichaId);
    const filas = await tx.ingresoFicha.findMany({ where: { fichaClinicaId: fichaId }, select: VISTA_INGRESO, orderBy: { createdAt: 'asc' } });
    await registrarAcceso(tx, this.bd.usuario(), [{ pacienteId: ficha.pacienteId, fichaId: ficha.id, recurso: 'ingresos_ficha', accion: 'LECTURA' }]);
    return filas.map(vista);
  }
}
