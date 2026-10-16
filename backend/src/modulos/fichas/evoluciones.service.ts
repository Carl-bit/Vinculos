import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { ADVERTENCIA_TEXTO_LIBRE } from '../../common/plantillas-clinicas';
import { registrarAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import type { CrearEvolucionDto } from './dto/fichas.dto';
import { PlantillasService, VISTA_PLANTILLA } from './plantillas.service';

export { ADVERTENCIA_TEXTO_LIBRE };

/** Valores explicitos de la copia de autoria cuando el autor no tiene el dato. */
const SIN_RUT = 'sin RUT registrado';
const SIN_REGISTRO = 'sin registro';

const VISTA_EVOLUCION = {
  id: true,
  fichaClinicaId: true,
  autorId: true,
  notas: true,
  autorNombre: true,
  autorRut: true,
  autorRegistro: true,
  nivelRiesgo: true,
  corrigeAId: true,
  citaId: true,
  createdAt: true,
  valores: true,
  plantilla: { select: VISTA_PLANTILLA },
  tipoSesion: { select: { id: true, nombre: true } },
  estadoAvance: { select: { id: true, nombre: true } },
  intervenciones: { select: { intervencion: { select: { id: true, nombre: true } } } },
} satisfies Prisma.EvolucionSelect;

type Evolucion = Prisma.EvolucionGetPayload<{ select: typeof VISTA_EVOLUCION }>;

function vista(e: Evolucion) {
  return {
    id: e.id,
    fichaClinicaId: e.fichaClinicaId,
    autorId: e.autorId,
    notas: texto(e.notas),
    copiaAutoria: { nombre: texto(e.autorNombre), rut: texto(e.autorRut), registro: texto(e.autorRegistro) },
    tipoSesion: e.tipoSesion,
    estadoAvance: e.estadoAvance,
    intervenciones: e.intervenciones.map((i) => i.intervencion),
    nivelRiesgo: e.nivelRiesgo,
    corrigeAId: e.corrigeAId,
    citaId: e.citaId,
    createdAt: e.createdAt,
    // 03a-2: cada registro con la version de plantilla con que se escribio.
    plantilla: e.plantilla,
    valores: e.valores ? (JSON.parse(texto(e.valores)) as Record<string, unknown>) : null,
  };
}

/**
 * Evoluciones (append-only): crear y corregir (fila nueva con corrige_a_id).
 * Solo el tratante (PROFESIONAL, o PRACTICANTE con consentimiento vigente):
 * lo impone la RLS. ADMIN nunca llega aqui (guard) ni lee evoluciones (RLS).
 */
@Injectable()
export class EvolucionesService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly plantillas: PlantillasService,
  ) {}

  /**
   * Copia de autoria con los datos actuales del autor (nombre de usuarios,
   * RUT de profesional_datos_privados, registro de profesional_trayectoria),
   * cifrada: sobrevive al cierre de su cuenta. Las intervenciones se insertan
   * en la misma transaccion (despues la BD no lo permite).
   */
  async crear(fichaId: string, dto: CrearEvolucionDto) {
    const tx = this.bd.tx();
    const actor = this.bd.usuario();
    const ficha = encontrado(await tx.fichaClinica.findUnique({ where: { id: fichaId }, select: { id: true, pacienteId: true } }), 'Ficha');
    const autor = await tx.usuario.findUniqueOrThrow({ where: { id: actor.id }, select: { nombre: true } });
    const privados = await tx.profesionalDatosPrivados.findUnique({ where: { usuarioId: actor.id }, select: { usuarioId: true, rut: true } });
    const trayectoria = await tx.profesionalTrayectoria.findFirst({
      where: { profesionalId: actor.id, registroSuperintendencia: { not: null } },
      orderBy: [{ anio: 'desc' }, { createdAt: 'desc' }],
      select: { registroSuperintendencia: true },
    });

    const valores = dto.plantillaId ? await this.plantillas.valoresValidos(dto.plantillaId, dto.valores!) : undefined;

    const id = randomUUID();
    await tx.evolucion.create({
      data: {
        id,
        fichaClinicaId: ficha.id,
        autorId: actor.id,
        notas: claro(dto.notas),
        autorNombre: claro(autor.nombre ?? 'sin nombre'),
        autorRut: claro(texto(privados?.rut) ?? SIN_RUT),
        autorRegistro: claro(trayectoria?.registroSuperintendencia ?? SIN_REGISTRO),
        tipoSesionId: dto.tipoSesionId,
        estadoAvanceId: dto.estadoAvanceId,
        nivelRiesgo: dto.nivelRiesgo,
        corrigeAId: dto.corrigeAId,
        citaId: dto.citaId,
        plantillaId: dto.plantillaId,
        valores: claro(valores),
      },
      select: { id: true },
    });
    if (dto.intervencionIds?.length) {
      await tx.evolucionIntervencion.createMany({ data: dto.intervencionIds.map((intervencionId) => ({ evolucionId: id, intervencionId })) });
    }
    await registrarAcceso(tx, actor, [{ pacienteId: ficha.pacienteId, fichaId: ficha.id, recurso: 'evoluciones', accion: 'ESCRITURA' }]);
    const evolucion = await tx.evolucion.findUniqueOrThrow({ where: { id }, select: VISTA_EVOLUCION });
    return { evolucion: vista(evolucion), advertencia: ADVERTENCIA_TEXTO_LIBRE };
  }

  async listar(fichaId: string) {
    const tx = this.bd.tx();
    const ficha = encontrado(await tx.fichaClinica.findUnique({ where: { id: fichaId }, select: { id: true, pacienteId: true } }), 'Ficha');
    const filas = await tx.evolucion.findMany({ where: { fichaClinicaId: fichaId }, select: VISTA_EVOLUCION, orderBy: { createdAt: 'asc' } });
    await registrarAcceso(tx, this.bd.usuario(), [{ pacienteId: ficha.pacienteId, fichaId: ficha.id, recurso: 'evoluciones', accion: 'LECTURA' }]);
    return filas.map(vista);
  }
}
