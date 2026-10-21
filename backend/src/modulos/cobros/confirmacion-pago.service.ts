import { randomUUID } from 'node:crypto';

import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EstadoTransferencia, MedioConfirmacion } from '@prisma/client';

import { hashToken, nuevoTokenCorreo } from '../../core/auth/tokens-correo';
import { registrarAcceso } from '../../core/bd/auditoria';
import { claro, texto } from '../../core/bd/claro';
import { ContextoBd, encontrado, type Tx } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import { type EventoPasarela, PasarelaSimulada, ProveedorPasarela } from '../../core/integraciones/pasarela';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import { ConcrecionReserva } from '../../core/reservas/concrecion-reserva';
import { nombreArchivo, tipoPorContenido } from '../../core/validacion/archivos';
import type { RegistrarPagoDto } from './dto/cobros.dto';
import type { CuentaCentroDto } from './dto/confirmacion-pago.dto';
import type {
  CajaReserva,
  CobroIniciado,
  CuentaCentroVista,
  DatosTransferencia,
  EstadoConfirmacion,
  ResumenEnlacePago,
  TransferenciaVista,
} from './dto/confirmacion-pago.dto';

interface FilaEstado {
  estado: EstadoConfirmacion['estado'];
  vence_en: Date | null;
  siguiente: EstadoConfirmacion['siguiente'];
  medios: MedioConfirmacion[] | null;
  medio: MedioConfirmacion | null;
  monto: number | null;
  comprobante_recibido: boolean;
  motivo_rechazo: string | null;
}

type ColumnaCuenta = 'rut' | 'banco' | 'tipo_cuenta' | 'numero_cuenta' | 'titular';

interface FilaTransferencia extends Record<ColumnaCuenta, Uint8Array | null> {
  origen: 'CENTRO' | 'PROFESIONAL';
  cuenta_id: string;
  monto: number;
  vence_en: Date | null;
}

/**
 * Cliente con el que corre cada camino: reserva sin cuenta y enlace de pago
 * (03b-3.4; sin contexto, por el hash del token) o cuenta del paciente (RLS).
 */
type Camino = { tipo: 'reserva'; hash: Buffer } | { tipo: 'enlace'; hash: Buffer; token: string } | { tipo: 'portal'; citaId: string };

const VISTA_TRANSFERENCIA = {
  id: true,
  citaId: true,
  estado: true,
  comprobanteSubidoEn: true,
  motivoRechazo: true,
  resueltaEn: true,
  creadaEn: true,
  cita: { select: { profesionalId: true, pacienteId: true, inicio: true, pagoVenceEn: true, monto: true } },
} as const;

/**
 * 03b-3.1: la cita se confirma segun el medio de pago. Toda regla de estado
 * vive en funciones de la BD (SECURITY DEFINER); aqui solo se arman los dos
 * caminos del paciente (token opaco de la reserva sin cuenta, o su cuenta),
 * se cifra/descifra y se habla con la pasarela (interfaz de core).
 *
 * 03b-3.2: la reserva sin cuenta es una cita RETENIDA sin paciente. El pago
 * registrado (transferencia validada o webhook) la concreta en la misma
 * transaccion (ConcrecionReserva: paciente, ficha, cita CONFIRMADA) y la
 * invitacion a la cuenta sale despues del COMMIT. Pago en el centro elegido
 * en la reserva: el gatillo es el correo (se envia el enlace).
 *
 * - Reserva sin cuenta: el token (256 bits) solo autoriza ver estado,
 *   vencimiento y siguiente paso, elegir el medio, ver los datos para
 *   transferir, subir el comprobante e iniciar el pago en linea de ESA cita.
 * - Comprobante: PDF, PNG o JPEG validado por contenido, cifrado (FINANCIERO)
 *   con el id de la transferencia.
 * - Webhook: firma verificada por el adaptador; la BD lo hace idempotente.
 * Nunca se loguean tokens, datos bancarios ni comprobantes.
 *
 * 03b-3.4: la sesion ya realizada con saldo (SALDO_PENDIENTE) se paga por
 * los mismos caminos y funciones; y quien no tiene cuenta paga con el enlace
 * del correo (token PAGO_CITA, varios usos hasta vencer; solo esa cita).
 */
@Injectable()
export class ConfirmacionPagoService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
    private readonly pasarela: ProveedorPasarela,
    private readonly config: ConfigService,
    private readonly correos: CorreosCuenta,
    private readonly concrecion: ConcrecionReserva,
  ) {}

  estadoReserva(reserva: string): Promise<EstadoConfirmacion> {
    return this.estado({ tipo: 'reserva', hash: hashToken(reserva) });
  }

  estadoPortal(citaId: string): Promise<EstadoConfirmacion> {
    return this.estado({ tipo: 'portal', citaId });
  }

  estadoEnlace(camino: Extract<Camino, { tipo: 'enlace' }>): Promise<EstadoConfirmacion> {
    return this.estado(camino);
  }

  async resumenEnlace(enlace: string): Promise<ResumenEnlacePago> {
    const [r] = await this.publico().$queryRaw<ResumenEnlacePago[]>`SELECT * FROM resumen_enlace_pago(${hashToken(enlace)})`;
    return encontrado(r, 'Enlace de pago');
  }

  async elegirMedio(camino: Camino, medio: MedioConfirmacion): Promise<EstadoConfirmacion> {
    // Id de la transferencia (AAD del comprobante): lo genera la API; la BD lo usa solo si crea la fila.
    const id = randomUUID();
    if (camino.tipo === 'reserva') {
      const { token, hash } = nuevoTokenCorreo();
      const [r] = await this.publico().$queryRaw<{ verificacion_email: string | null; retencion_vence: Date | null }[]>`
        SELECT verificacion_email, retencion_vence FROM elegir_medio_reserva(${camino.hash}, ${medio}::medio_confirmacion, ${id}::uuid, ${hash})`;
      if (r.verificacion_email && r.retencion_vence) {
        await this.correos.enviar('VERIFICACION_SOLICITUD', r.verificacion_email, token, r.retencion_vence);
      }
    } else if (camino.tipo === 'enlace') {
      await this.publico().$queryRaw`SELECT elegir_medio_enlace(${camino.hash}, ${medio}::medio_confirmacion, ${id}::uuid)`;
    } else {
      await this.bd.tx().$queryRaw`SELECT elegir_medio_portal(${camino.citaId}::uuid, ${medio}::medio_confirmacion, ${id}::uuid)`;
    }
    return this.estado(camino);
  }

  async datosTransferencia(camino: Camino): Promise<DatosTransferencia> {
    const [f] =
      camino.tipo === 'portal'
        ? await this.bd.tx().$queryRaw<FilaTransferencia[]>`SELECT * FROM datos_transferencia_portal(${camino.citaId}::uuid)`
        : camino.tipo === 'enlace'
          ? await this.publico().$queryRaw<FilaTransferencia[]>`SELECT * FROM datos_transferencia_enlace(${camino.hash})`
          : await this.publico().$queryRaw<FilaTransferencia[]>`SELECT * FROM datos_transferencia_reserva(${camino.hash})`;
    if (!f) {
      throw new UnprocessableEntityException({ message: 'No hay una cuenta registrada para transferir', restriccion: 'citas_transferencia_sin_cuenta' });
    }
    const [tabla, idColumna] = f.origen === 'CENTRO' ? ['cuenta_bancaria_centro', f.cuenta_id] : ['profesional_datos_privados', f.cuenta_id];
    const d = (col: ColumnaCuenta) => this.llavero.descifrarCampo(f[col], tabla, col, idColumna) ?? '';
    return {
      origen: f.origen,
      rut: d('rut'),
      banco: d('banco'),
      tipoCuenta: d('tipo_cuenta'),
      numeroCuenta: d('numero_cuenta'),
      titular: d('titular'),
      monto: f.monto,
      venceEn: f.vence_en,
    };
  }

  async subirComprobante(camino: Camino, archivo: Express.Multer.File): Promise<EstadoConfirmacion> {
    const tipo = tipoPorContenido(archivo.buffer);
    if (!tipo) {
      throw new UnprocessableEntityException({ message: 'Solo PDF, PNG o JPEG (validado por contenido)', restriccion: 'transferencias_coherente' });
    }
    const nombre = nombreArchivo(archivo.originalname, 'comprobante');
    const guardar = async (tx: Tx) => {
      const [{ id }] =
        camino.tipo === 'reserva'
          ? await tx.$queryRaw<[{ id: string }]>`SELECT transferencia_de_reserva(${camino.hash}) AS id`
          : camino.tipo === 'enlace'
            ? await tx.$queryRaw<[{ id: string }]>`SELECT transferencia_de_enlace(${camino.hash}) AS id`
            : await tx.$queryRaw<[{ id: string }]>`SELECT transferencia_portal(${camino.citaId}::uuid) AS id`;
      const contenido = this.llavero.cifrarCampo(archivo.buffer.toString('base64'), 'transferencias', 'comprobante', id);
      if (camino.tipo === 'reserva') {
        await tx.$executeRaw`SELECT subir_comprobante_reserva(${camino.hash}, ${contenido}, ${tipo}, ${nombre})`;
      } else if (camino.tipo === 'enlace') {
        await tx.$executeRaw`SELECT subir_comprobante_enlace(${camino.hash}, ${contenido}, ${tipo}, ${nombre})`;
      } else {
        await tx.$executeRaw`SELECT subir_comprobante_portal(${camino.citaId}::uuid, ${contenido}, ${tipo}, ${nombre})`;
      }
    };
    if (camino.tipo === 'portal') {
      await guardar(this.bd.tx());
    } else {
      await this.publico().$transaction(guardar);
    }
    return this.estado(camino);
  }

  /** Crea el intento de cobro (la BD fija el monto) y pide la URL de pago al adaptador. */
  async iniciarPasarela(camino: Camino): Promise<CobroIniciado> {
    const [c] =
      camino.tipo === 'portal'
        ? await this.bd.tx().$queryRaw<{ cobro_id: string; monto: number }[]>`SELECT * FROM iniciar_cobro_portal(${camino.citaId}::uuid)`
        : camino.tipo === 'enlace'
          ? await this.publico().$queryRaw<{ cobro_id: string; monto: number }[]>`SELECT * FROM iniciar_cobro_enlace(${camino.hash})`
          : await this.publico().$queryRaw<{ cobro_id: string; monto: number }[]>`SELECT * FROM iniciar_cobro_reserva(${camino.hash})`;
    const base = this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
    const { urlPago } = await this.pasarela.crearCobro({
      referencia: c.cobro_id,
      monto: c.monto,
      // El enlace vuelve a su pagina (el token ya venia en el enlace del correo).
      retorno: camino.tipo === 'reserva' ? `${base}/pedir-hora` : camino.tipo === 'enlace' ? `${base}/pagar?t=${camino.token}` : `${base}/portal`,
    });
    return { referencia: c.cobro_id, urlPago, simulada: this.pasarela.simulada };
  }

  /** Webhook de la pasarela: firma verificada por el adaptador; la BD es idempotente. */
  async webhook(cuerpo: unknown, firma: string | undefined) {
    return this.confirmar(this.pasarela.verificarWebhook(cuerpo, firma));
  }

  /** Solo modo demostracion: arma el evento firmado que mandaria la pasarela y lo procesa igual que el webhook. */
  async pagoSimulado(referencia: string, pagado: boolean) {
    if (!(this.pasarela instanceof PasarelaSimulada)) {
      throw new NotFoundException('La pasarela simulada no esta habilitada');
    }
    const { cuerpo, firma } = this.pasarela.simular(referencia, pagado);
    return this.webhook(cuerpo, firma);
  }

  listarTransferencias(estado?: EstadoTransferencia): Promise<TransferenciaVista[]> {
    return this.bd
      .tx()
      .transferencia.findMany({ where: { estado }, select: VISTA_TRANSFERENCIA, orderBy: { creadaEn: 'asc' } })
      .then((filas) => filas.map((t) => this.vistaTransferencia(t)));
  }

  /** Valida y, si es una reserva sin cuenta, la concreta en la misma transaccion. */
  async validarTransferencia(citaId: string): Promise<TransferenciaVista> {
    const tx = this.bd.tx();
    await tx.$queryRaw`SELECT validar_transferencia(${citaId}::uuid)`;
    const concretada = await this.concrecion.trasPago(tx, citaId);
    this.bd.alConfirmar(() => this.concrecion.enviarInvitacion(concretada));
    return this.transferenciaDeCita(citaId);
  }

  /**
   * 03b-3.3: pago en caja de la hora retenida (presencial; cobra quien valida
   * transferencias de esa cita). Concreta la reserva en la misma transaccion;
   * la invitacion a la cuenta sale despues del COMMIT.
   */
  async cobrarEnCaja(citaId: string, dto: RegistrarPagoDto): Promise<CajaReserva> {
    const tx = this.bd.tx();
    await tx.$queryRaw`SELECT cobrar_reserva_en_caja(${citaId}::uuid, ${dto.monto}::int, ${dto.medioPago}::medio_pago)`;
    const concretada = await this.concrecion.trasPago(tx, citaId);
    if (!concretada) {
      throw new NotFoundException('Cita inexistente');
    }
    this.bd.alConfirmar(() => this.concrecion.enviarInvitacion(concretada));
    return { citaId, pacienteId: concretada.pacienteId, estado: concretada.estado === 'CONFIRMADA' ? 'CONFIRMADA' : 'LIBERADA' };
  }

  async rechazarTransferencia(citaId: string, motivo: string): Promise<TransferenciaVista> {
    await this.bd.tx().$executeRaw`SELECT rechazar_transferencia(${citaId}::uuid, ${motivo})`;
    return this.transferenciaDeCita(citaId);
  }

  /** Comprobante para quien valida (RLS); queda en accesos_ficha si ya hay paciente. */
  async comprobante(id: string) {
    const tx = this.bd.tx();
    const t = encontrado(
      await tx.transferencia.findUnique({
        where: { id },
        select: { comprobante: true, comprobanteTipo: true, comprobanteNombre: true, cita: { select: { pacienteId: true } } },
      }),
      'Transferencia',
    );
    if (!t.comprobante || !t.comprobanteTipo) {
      throw new NotFoundException('La transferencia no tiene comprobante');
    }
    // Reserva sin cuenta (sin paciente aun): no hay ficha a la que imputar el acceso.
    if (t.cita.pacienteId) {
      await registrarAcceso(tx, this.bd.usuario(), [{ pacienteId: t.cita.pacienteId, recurso: 'transferencias', accion: 'LECTURA' }]);
    }
    return { contenido: Buffer.from(texto(t.comprobante), 'base64'), tipo: t.comprobanteTipo, nombre: t.comprobanteNombre ?? 'comprobante' };
  }

  async cuentaCentro(): Promise<CuentaCentroVista | null> {
    const c = await this.bd.tx().cuentaBancariaCentro.findFirst();
    return c ? this.vistaCuenta(c) : null;
  }

  async guardarCuentaCentro(dto: CuentaCentroDto): Promise<CuentaCentroVista> {
    const tx = this.bd.tx();
    const datos = {
      rut: claro(dto.rut),
      banco: claro(dto.banco),
      tipoCuenta: claro(dto.tipoCuenta),
      numeroCuenta: claro(dto.numeroCuenta),
      titular: claro(dto.titular),
    };
    const actual = await tx.cuentaBancariaCentro.findFirst({ select: { id: true } });
    const c = actual
      ? await tx.cuentaBancariaCentro.update({ where: { id: actual.id }, data: datos })
      : await tx.cuentaBancariaCentro.create({ data: { id: randomUUID(), ...datos } });
    return this.vistaCuenta(c);
  }

  private async estado(camino: Camino): Promise<EstadoConfirmacion> {
    const [f] =
      camino.tipo === 'portal'
        ? await this.bd.tx().$queryRaw<FilaEstado[]>`SELECT * FROM estado_pago_portal(${camino.citaId}::uuid)`
        : camino.tipo === 'enlace'
          ? await this.publico().$queryRaw<FilaEstado[]>`SELECT * FROM estado_pago_enlace(${camino.hash})`
          : await this.publico().$queryRaw<FilaEstado[]>`SELECT * FROM estado_reserva(${camino.hash})`;
    return {
      estado: f.estado,
      venceEn: f.vence_en,
      siguiente: f.siguiente,
      medios: f.medios,
      medio: f.medio,
      monto: f.monto,
      comprobanteRecibido: f.comprobante_recibido,
      motivoRechazo: f.motivo_rechazo,
      pasarelaSimulada: this.pasarela.simulada,
    };
  }

  /** Registra el resultado y, si pago una reserva sin cuenta, la concreta en la misma transaccion. */
  private async confirmar(e: EventoPasarela): Promise<{ estado: 'PENDIENTE' | 'PAGADO' | 'FALLIDO' }> {
    const { estado, concretada } = await this.publico().$transaction(async (tx) => {
      const [r] = await tx.$queryRaw<[{ estado: 'PENDIENTE' | 'PAGADO' | 'FALLIDO'; cita_id: string }]>`
        SELECT estado, cita_id FROM confirmar_cobro_pasarela(${e.referencia}::uuid, ${e.eventoId}, ${e.pagado})`;
      return { estado: r.estado, concretada: r.estado === 'PAGADO' ? await this.concrecion.trasPago(tx, r.cita_id) : null };
    });
    await this.concrecion.enviarInvitacion(concretada);
    return { estado };
  }

  private async transferenciaDeCita(citaId: string): Promise<TransferenciaVista> {
    // 03b-3.4: la cita puede tener una validada y despues otra (saldo): la mas reciente.
    const t = encontrado(
      await this.bd.tx().transferencia.findFirst({ where: { citaId }, select: VISTA_TRANSFERENCIA, orderBy: { creadaEn: 'desc' } }),
      'Transferencia',
    );
    return this.vistaTransferencia(t);
  }

  private vistaTransferencia(t: {
    id: string;
    citaId: string;
    estado: EstadoTransferencia;
    comprobanteSubidoEn: Date | null;
    motivoRechazo: string | null;
    resueltaEn: Date | null;
    creadaEn: Date;
    cita: { profesionalId: string; pacienteId: string | null; inicio: Date; pagoVenceEn: Date | null; monto: number | null };
  }): TransferenciaVista {
    const { cita, ...resto } = t;
    return { ...resto, comprobanteRecibido: !!t.comprobanteSubidoEn, ...cita };
  }

  private vistaCuenta(c: { rut: Uint8Array; banco: Uint8Array; tipoCuenta: Uint8Array; numeroCuenta: Uint8Array; titular: Uint8Array; updatedAt: Date }) {
    return {
      rut: texto(c.rut),
      banco: texto(c.banco),
      tipoCuenta: texto(c.tipoCuenta),
      numeroCuenta: texto(c.numeroCuenta),
      titular: texto(c.titular),
      updatedAt: c.updatedAt,
    };
  }

  private publico() {
    return this.bd.sinContexto('publico');
  }
}

export type { Camino };
