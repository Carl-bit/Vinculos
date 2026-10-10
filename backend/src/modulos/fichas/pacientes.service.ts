import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { registrarAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { conflicto, esSqlstate } from '../../core/errores/sqlstate';
import type { CrearAdultoResponsableDto, CrearPacienteDto, EditarPacienteDto } from './dto/fichas.dto';

const VISTA_PACIENTE = {
  id: true,
  nombre: true,
  apellido: true,
  rut: true,
  fechaNacimiento: true,
  email: true,
  telefono: true,
  profesionalId: true,
  codigoSeudonimo: true,
  tipoAtencionId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PacienteSelect;

const VISTA_ADULTO = {
  id: true,
  pacienteId: true,
  nombre: true,
  parentesco: true,
  telefono: true,
  email: true,
  rut: true,
  createdAt: true,
} satisfies Prisma.AdultoResponsableSelect;

type Paciente = Prisma.PacienteGetPayload<{ select: typeof VISTA_PACIENTE }>;
type Adulto = Prisma.AdultoResponsableGetPayload<{ select: typeof VISTA_ADULTO }>;

/** Unico indice unico que la API puede violar al crear/editar pacientes. */
function rutDuplicado(error: unknown): never {
  throw esSqlstate(error, '23505') ? conflicto('pacientes_rut_hmac_key') : error;
}

const vistaPaciente = (p: Paciente) => ({ ...p, rut: texto(p.rut), telefono: texto(p.telefono) });
const vistaAdulto = (a: Adulto) => ({ ...a, rut: texto(a.rut), telefono: texto(a.telefono) });

/**
 * Pacientes (datos administrativos), adultos responsables y metadata de la
 * ficha. Sin DELETE (no hay endpoint ni GRANT). El tratante cambia solo via
 * derivacion. RUT cifrado + indice ciego rut_hmac para la busqueda exacta.
 */
@Injectable()
export class PacientesService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  /**
   * PROFESIONAL crea pacientes propios; ADMIN/GESTION indican el tratante. Si
   * el actor puede (ADMIN o el tratante), abre la ficha en la misma
   * transaccion; si lo crea GESTION, la abre despues el tratante o ADMIN.
   */
  async crear(dto: CrearPacienteDto) {
    const tx = this.bd.tx();
    const actor = this.bd.usuario();
    const profesionalId = actor.rol === 'PROFESIONAL' ? actor.id : dto.profesionalId;
    if (!profesionalId) {
      throw new BadRequestException('profesionalId es obligatorio');
    }
    const id = randomUUID();
    const paciente = await tx.paciente.create({
      data: {
        id,
        nombre: dto.nombre,
        apellido: dto.apellido,
        rut: claro(dto.rut),
        rutHmac: dto.rut ? this.llavero.hmacRut(dto.rut) : null,
        fechaNacimiento: dto.fechaNacimiento,
        email: dto.email,
        telefono: claro(dto.telefono),
        profesionalId,
        tipoAtencionId: dto.tipoAtencionId,
      },
      select: VISTA_PACIENTE,
    }).catch(rutDuplicado);
    let fichaId: string | null = null;
    if (actor.rol === 'ADMIN' || actor.rol === 'PROFESIONAL') {
      fichaId = (await tx.fichaClinica.create({ data: { pacienteId: id }, select: { id: true } })).id;
      await registrarAcceso(tx, actor, [{ pacienteId: id, fichaId, recurso: 'fichas_clinicas', accion: 'ESCRITURA' }]);
    }
    return { ...vistaPaciente(paciente), fichaId };
  }

  /** Lista segun la RLS del rol; con rut, busqueda exacta por el indice ciego. */
  async listar(rut?: string) {
    const filas = await this.bd.tx().paciente.findMany({
      where: { deletedAt: null, ...(rut ? { rutHmac: this.llavero.hmacRut(rut) } : {}) },
      select: VISTA_PACIENTE,
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });
    return filas.map(vistaPaciente);
  }

  async obtener(id: string) {
    return vistaPaciente(encontrado(await this.bd.tx().paciente.findFirst({ where: { id, deletedAt: null }, select: VISTA_PACIENTE }), 'Paciente'));
  }

  async editar(id: string, dto: EditarPacienteDto) {
    const tx = this.bd.tx();
    encontrado(await tx.paciente.findFirst({ where: { id, deletedAt: null }, select: { id: true } }), 'Paciente');
    const paciente = await tx.paciente.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        apellido: dto.apellido,
        rut: claro(dto.rut),
        rutHmac: dto.rut ? this.llavero.hmacRut(dto.rut) : undefined,
        fechaNacimiento: dto.fechaNacimiento,
        email: dto.email,
        telefono: dto.telefono === undefined ? undefined : claro(dto.telefono),
      },
      select: VISTA_PACIENTE,
    }).catch(rutDuplicado);
    return vistaPaciente(paciente);
  }

  async crearAdultoResponsable(pacienteId: string, dto: CrearAdultoResponsableDto) {
    const tx = this.bd.tx();
    await this.obtener(pacienteId);
    const adulto = await tx.adultoResponsable.create({
      data: {
        id: randomUUID(),
        pacienteId,
        nombre: dto.nombre,
        parentesco: dto.parentesco,
        telefono: claro(dto.telefono),
        email: dto.email,
        rut: claro(dto.rut),
        rutHmac: dto.rut ? this.llavero.hmacRut(dto.rut) : null,
      },
      select: VISTA_ADULTO,
    });
    return vistaAdulto(adulto);
  }

  async adultosResponsables(pacienteId: string) {
    await this.obtener(pacienteId);
    const filas = await this.bd.tx().adultoResponsable.findMany({ where: { pacienteId }, select: VISTA_ADULTO, orderBy: { createdAt: 'asc' } });
    return filas.map(vistaAdulto);
  }

  /** Metadata de la ficha (ADMIN la ve; nunca las evoluciones). Auditada. */
  async ficha(pacienteId: string) {
    const tx = this.bd.tx();
    const ficha = encontrado(await tx.fichaClinica.findUnique({ where: { pacienteId } }), 'Ficha');
    await registrarAcceso(tx, this.bd.usuario(), [{ pacienteId, fichaId: ficha.id, recurso: 'fichas_clinicas', accion: 'LECTURA' }]);
    return ficha;
  }

  async abrirFicha(pacienteId: string) {
    const tx = this.bd.tx();
    await this.obtener(pacienteId);
    const ficha = await tx.fichaClinica.create({ data: { pacienteId } });
    await registrarAcceso(tx, this.bd.usuario(), [{ pacienteId, fichaId: ficha.id, recurso: 'fichas_clinicas', accion: 'ESCRITURA' }]);
    return ficha;
  }
}
