import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { registrarAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { HORA, nuevoTokenCorreo } from '../../core/auth/tokens-correo';
import { conflicto, esSqlstate } from '../../core/errores/sqlstate';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import type { BuscarPacientesDto, CrearAdultoResponsableDto, CrearPacienteDto, EditarPacienteDto, InvitarPacienteDto } from './dto/fichas.dto';

const MAYORIA_EDAD_MS = 18 * 365.25 * 86_400_000;

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
  contactoEmergencia: true,
  creadoPorSolicitud: true,
  posibleDuplicado: true,
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

const vistaPaciente = (p: Paciente) => ({ ...p, rut: texto(p.rut), telefono: texto(p.telefono), contactoEmergencia: texto(p.contactoEmergencia) });
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
    private readonly correos: CorreosCuenta,
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
    const paciente = await tx.paciente
      .create({
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
          contactoEmergencia: claro(dto.contactoEmergencia),
        },
        select: VISTA_PACIENTE,
      })
      .catch(rutDuplicado);
    let fichaId: string | null = null;
    if (actor.rol === 'ADMIN' || actor.rol === 'PROFESIONAL') {
      fichaId = (await tx.fichaClinica.create({ data: { pacienteId: id }, select: { id: true } })).id;
      await registrarAcceso(tx, actor, [{ pacienteId: id, fichaId, recurso: 'fichas_clinicas', accion: 'ESCRITURA' }]);
    }
    return { ...vistaPaciente(paciente), fichaId };
  }

  /**
   * Lista segun la RLS del rol; con rut, busqueda exacta por el indice ciego.
   * Filtros (03a): tratante, menores, posibles duplicados, derivados y nombre.
   */
  async listar(filtro: BuscarPacientesDto = {}) {
    const where: Prisma.PacienteWhereInput = { deletedAt: null };
    if (filtro.rut) where.rutHmac = this.llavero.hmacRut(filtro.rut);
    if (filtro.profesionalId) where.profesionalId = filtro.profesionalId;
    if (filtro.menores) where.fechaNacimiento = { gt: new Date(Date.now() - MAYORIA_EDAD_MS) };
    if (filtro.duplicados) where.posibleDuplicado = true;
    if (filtro.derivados) where.fichaClinica = { derivaciones: { some: { estado: 'ACEPTADA' } } };
    if (filtro.nombre) {
      where.OR = [{ nombre: { contains: filtro.nombre, mode: 'insensitive' } }, { apellido: { contains: filtro.nombre, mode: 'insensitive' } }];
    }
    const filas = await this.bd.tx().paciente.findMany({
      where,
      select: VISTA_PACIENTE,
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });
    return filas.map(vistaPaciente);
  }

  async obtener(id: string) {
    const p = await this.bd.tx().paciente.findFirst({ where: { id, deletedAt: null }, select: VISTA_PACIENTE });
    if (!p) {
      throw new NotFoundException('Paciente no encontrado');
    }
    return vistaPaciente(p);
  }

  async editar(id: string, dto: EditarPacienteDto) {
    const tx = this.bd.tx();
    encontrado(await tx.paciente.findFirst({ where: { id, deletedAt: null }, select: { id: true } }), 'Paciente');
    const paciente = await tx.paciente
      .update({
        where: { id },
        data: {
          nombre: dto.nombre,
          apellido: dto.apellido,
          rut: claro(dto.rut),
          rutHmac: dto.rut ? this.llavero.hmacRut(dto.rut) : undefined,
          fechaNacimiento: dto.fechaNacimiento,
          email: dto.email,
          telefono: dto.telefono === undefined ? undefined : claro(dto.telefono),
          contactoEmergencia: dto.contactoEmergencia === undefined ? undefined : claro(dto.contactoEmergencia),
        },
        select: VISTA_PACIENTE,
      })
      .catch(rutDuplicado);
    return vistaPaciente(paciente);
  }

  /** GESTION/ADMIN concilian un posible duplicado (D-2): se revisa a mano; nunca se fusiona por nombre. */
  async duplicadoRevisado(id: string) {
    await this.obtener(id);
    return vistaPaciente(await this.bd.tx().paciente.update({ where: { id }, data: { posibleDuplicado: false }, select: VISTA_PACIENTE }));
  }

  /**
   * Invitacion de cuenta (ADMIN/GESTION, 03a): el paciente desde los 14
   * años; si es menor, su adulto responsable (cuenta RESPONSABLE). Enlace de
   * un solo uso por correo, enviado despues del COMMIT.
   */
  async invitar(pacienteId: string, dto: InvitarPacienteDto) {
    const p = await this.obtener(pacienteId);
    const menor = p.fechaNacimiento.getTime() > Date.now() - MAYORIA_EDAD_MS;
    const { token, hash } = nuevoTokenCorreo();
    const vence = new Date(Date.now() + 72 * HORA);
    const tx = this.bd.tx();
    let email: string;
    if (menor && dto.adultoResponsableId) {
      [{ email }] = await tx.$queryRaw<[{ email: string }]>`
        SELECT crear_invitacion_responsable(${dto.adultoResponsableId}::uuid, ${dto.email ?? null}, ${hash}, ${vence}) AS email`;
    } else if (menor && !dto.adultoResponsableId && p.fechaNacimiento.getTime() > Date.now() - 14 * 365.25 * 86_400_000) {
      throw new BadRequestException('Menor de 14: la cuenta es del adulto responsable (indicar adultoResponsableId)');
    } else {
      [{ email }] = await tx.$queryRaw<[{ email: string }]>`
        SELECT crear_invitacion_paciente(${pacienteId}::uuid, ${dto.email ?? null}, ${hash}, ${vence}) AS email`;
    }
    this.bd.alConfirmar(() => this.correos.enviar('INVITACION', email, token, vence));
    return { pacienteId, invitacionVence: vence };
  }

  /** Consentimiento informado de atencion registrado por ADMIN/GESTION con respaldo (D-3, canal PRESENCIAL). */
  async consentimientoAtencion(pacienteId: string, respaldoRef: string, adultoId?: string) {
    await this.obtener(pacienteId);
    const [{ id }] = await this.bd.tx().$queryRaw<[{ id: string }]>`
      SELECT registrar_aceptacion('CONSENTIMIENTO_ATENCION', ${pacienteId}::uuid, ${adultoId ?? null}::uuid, ${respaldoRef}) AS id`;
    return { id, pacienteId };
  }

  /** Enlace de consentimiento de atencion por correo (D-3). */
  async enlaceConsentimientoAtencion(pacienteId: string) {
    await this.obtener(pacienteId);
    return this.correos.enlaceConsentimiento(pacienteId);
  }

  /** Politicas aceptadas por el paciente (version y canal), segun la RLS. */
  async aceptaciones(pacienteId: string) {
    await this.obtener(pacienteId);
    return this.bd.tx().aceptacionPolitica.findMany({
      where: { pacienteId },
      select: {
        id: true,
        canal: true,
        otorgadoPor: true,
        adultoResponsableId: true,
        respaldoRef: true,
        aceptadaEn: true,
        politica: { select: { tipo: true, version: true } },
      },
      orderBy: { aceptadaEn: 'desc' },
    });
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
