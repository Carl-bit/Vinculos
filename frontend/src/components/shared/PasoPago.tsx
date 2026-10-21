'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoClp, formatoFechaHora, formatoRut } from '@/lib/formato';
import { MEDIOS, type CaminoPago, type CobroIniciado, type EstadoConfirmacion, type MedioConfirmacion } from '@/lib/pagos';

const mensaje = (e: unknown, porDefecto: string) => (e instanceof ApiError ? e.message : porDefecto);

const PAGO_EN_CENTRO_SIN_CUENTA = 'Te enviamos un enlace al correo para reservar la hora a tu nombre. Pagas al llegar a tu sesión.';

/** 03b-3.4: el saldo de una sesion ya realizada no confirma nada: queda registrado. */
const DETALLE_SALDO: Partial<Record<MedioConfirmacion, string>> = {
  TRANSFERENCIA: 'Te mostramos los datos de la cuenta. El pago queda registrado cuando validamos la transferencia.',
  PASARELA: 'Pagas con tarjeta y el pago queda registrado al instante.',
};

/**
 * Paso de pago (03b-3.1), igual para la reserva sin cuenta y para la cuenta
 * del paciente: elegir el medio entre los habilitados por el centro, los
 * datos para transferir con el comprobante opcional, o el pago en linea. El
 * estado lo trae quien lo usa (sondeo); aqui solo se actua y se actualiza la
 * cache con la respuesta. 03b-3.2: en la reserva sin cuenta, pagar en el
 * centro envia el enlace al correo (VERIFICAR_CORREO); el comprobante subido
 * a tiempo mantiene la hora hasta que el centro valide. 03b-3.3: la hora que
 * agenda el equipo no se libera al vencer el plazo (se paga en el centro).
 * 03b-3.4: tambien el saldo de una sesion ya realizada (SALDO_PENDIENTE), con
 * los medios en linea del centro; sin ninguno, se paga en el centro.
 */
export function PasoPago({ camino, estado, seMantiene = false }: { camino: CaminoPago; estado: EstadoConfirmacion; seMantiene?: boolean }) {
  const cliente = useQueryClient();
  const [cambiando, setCambiando] = useState(false);
  const actualizar = (e: EstadoConfirmacion) => {
    cliente.setQueryData(['pago', ...camino.clave], e);
    setCambiando(false);
  };
  const plazo = estado.venceEn ? formatoFechaHora(estado.venceEn) : null;
  const monto = estado.monto ?? 0;

  if (estado.siguiente === 'ELEGIR_MEDIO' || cambiando) {
    return (
      <ElegirMedio
        camino={camino}
        estado={estado}
        plazo={plazo}
        seMantiene={seMantiene}
        onElegido={actualizar}
        onVolver={cambiando ? () => setCambiando(false) : undefined}
      />
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {(estado.siguiente === 'ESPERAR_VALIDACION' || estado.siguiente === 'TRANSFERENCIA_RECHAZADA') && (
        <Transferencia camino={camino} estado={estado} plazo={plazo} seMantiene={seMantiene} onSubido={actualizar} />
      )}
      {estado.siguiente === 'PAGAR_EN_LINEA' && <PagoEnLinea camino={camino} estado={estado} monto={monto} />}
      {estado.siguiente === 'PAGAR_EN_CENTRO' && (
        <Aviso tono="nota" icono="storefront" titulo="Pagas en el centro">
          El centro no tiene medios de pago en línea habilitados. Paga el saldo de {formatoClp(monto)} en tu próxima visita o directamente con el centro.
        </Aviso>
      )}
      {estado.siguiente === 'VERIFICAR_CORREO' && (
        <Aviso tono="nota" icono="storefront" titulo="Pagas en el centro">
          La hora queda reservada a tu nombre al abrir el enlace del correo. Pagas al llegar a tu sesión.
        </Aviso>
      )}
      {(estado.medios?.length ?? 0) > 1 && (
        <div>
          <Button variant="ghost" icon="swap_horiz" onClick={() => setCambiando(true)}>
            Elegir otro medio de pago
          </Button>
        </div>
      )}
    </div>
  );
}

function ElegirMedio({
  camino,
  estado,
  plazo,
  seMantiene,
  onElegido,
  onVolver,
}: {
  camino: CaminoPago;
  estado: EstadoConfirmacion;
  plazo: string | null;
  seMantiene: boolean;
  onElegido: (e: EstadoConfirmacion) => void;
  onVolver?: () => void;
}) {
  const medios = estado.medios ?? [];
  const saldo = estado.estado === 'SALDO_PENDIENTE';
  const [medio, setMedio] = useState<MedioConfirmacion | undefined>(estado.medio ?? (medios.length === 1 ? medios[0] : undefined));
  const [error, setError] = useState<string>();
  const elegir = useMutation({
    mutationFn: (m: MedioConfirmacion) => camino.elegir(m),
    onSuccess: onElegido,
    onError: (e) => setError(mensaje(e, 'No pudimos guardar el medio de pago. Intenta de nuevo.')),
  });
  const opciones = medios.map((m) => ({
    value: m,
    label: `${MEDIOS[m].titulo}${m === 'PASARELA' && estado.pasarelaSimulada ? ' (modo demostración)' : ''}: ${
      saldo ? (DETALLE_SALDO[m] ?? MEDIOS[m].detalle) : m === 'PAGO_EN_CENTRO' && camino.sinCuenta ? PAGO_EN_CENTRO_SIN_CUENTA : MEDIOS[m].detalle
    }`,
  }));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!medio) {
          setError('Elige cómo vas a pagar.');
          return;
        }
        setError(undefined);
        elegir.mutate(medio);
      }}
      noValidate
    >
      {estado.monto !== null && saldo && (
        <p className="m-0 max-w-[56ch] text-base leading-relaxed text-pretty text-neutral-700">
          Tu sesión tiene un saldo pendiente de <strong className="text-text">{formatoClp(estado.monto)}</strong>. Mientras no se pague, no puedes agendar una
          nueva hora.
        </p>
      )}
      {estado.monto !== null && !saldo && (
        <p className="m-0 max-w-[56ch] text-base leading-relaxed text-pretty text-neutral-700">
          Para confirmar tu hora pagas <strong className="text-text">{formatoClp(estado.monto)}</strong>. Si no se completa a tiempo
          {plazo && <> (plazo: {plazo})</>}, {seMantiene ? 'pagas en el centro el día de la atención.' : 'la hora se libera para otras personas.'}
        </p>
      )}
      <div className="rounded-lg border border-divider bg-neutral-100 p-[clamp(18px,3vw,28px)] shadow-sm">
        <ChoiceGroup
          legend="¿Cómo vas a pagar?"
          type="radio"
          required
          options={opciones}
          value={medio ? [medio] : []}
          onChange={([m]) => setMedio(m as MedioConfirmacion)}
          error={error}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="team" size="lg" icon="arrow_forward" loading={elegir.isPending}>
          Continuar
        </Button>
        {onVolver && (
          <Button variant="ghost" icon="arrow_back" onClick={onVolver}>
            Volver
          </Button>
        )}
      </div>
    </form>
  );
}

function Transferencia({
  camino,
  estado,
  plazo,
  seMantiene,
  onSubido,
}: {
  camino: CaminoPago;
  estado: EstadoConfirmacion;
  plazo: string | null;
  seMantiene: boolean;
  onSubido: (e: EstadoConfirmacion) => void;
}) {
  const cuenta = useQuery({ queryKey: ['pago', 'transferencia', ...camino.clave], queryFn: () => camino.transferencia(), staleTime: Infinity });
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const subir = useMutation({
    mutationFn: (archivo: File) => camino.comprobante(archivo),
    onSuccess: onSubido,
    onError: (e) => setError(mensaje(e, 'No pudimos subir el comprobante.')),
  });
  const elegir = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setError(undefined);
    subir.mutate(archivo);
  };
  const rechazada = estado.siguiente === 'TRANSFERENCIA_RECHAZADA';
  return (
    <>
      {rechazada && (
        <Aviso tono="advertencia" titulo="No pudimos validar tu transferencia" role="alert">
          {estado.motivoRechazo ? `Motivo: ${estado.motivoRechazo}. ` : ''}
          Revisa los datos y vuelve a transferir o sube otro comprobante{plazo ? ` (plazo: ${plazo})` : ''}.
        </Aviso>
      )}
      <section className="rounded-lg border border-divider bg-neutral-100 p-[clamp(18px,3vw,28px)] shadow-sm" aria-labelledby="titulo-transferencia">
        <h2 id="titulo-transferencia" className="m-0 mb-3.5 text-[19px] font-black tracking-[-0.025em]">
          Datos para transferir
        </h2>
        <EstadoConsulta consulta={cuenta}>
          {(c) => (
            <dl className="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {(
                [
                  ['Titular', c.titular],
                  ['RUT', formatoRut(c.rut)],
                  ['Banco', c.banco],
                  ['Tipo de cuenta', c.tipoCuenta],
                  ['Número de cuenta', c.numeroCuenta],
                  ['Monto', formatoClp(c.monto)],
                ] as const
              ).map(([t, v]) => (
                <div key={t}>
                  <dt className="text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">{t}</dt>
                  <dd className="m-0 text-[15px] font-extrabold break-words">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </EstadoConsulta>
        {plazo && (
          <p className="m-0 mt-4 text-[13.5px] font-bold text-accent-800">
            {estado.comprobanteRecibido
              ? `Con tu comprobante, la hora te espera hasta que validemos la transferencia (a más tardar: ${plazo}).`
              : `Sube el comprobante antes del plazo (${plazo}): con él, la hora te espera hasta que validemos la transferencia. ${seMantiene ? 'Sin pago a tiempo, pagas en el centro.' : 'Sin pago a tiempo, la hora se libera.'}`}
          </p>
        )}
      </section>
      <section className="flex flex-col gap-3" aria-live="polite">
        <p className="m-0 text-[14px] font-bold text-neutral-800">
          {estado.comprobanteRecibido && !rechazada
            ? 'Recibimos tu comprobante. Esperando la validación del centro: esta pantalla se actualiza sola.'
            : estado.estado === 'SALDO_PENDIENTE'
              ? 'Cuando el centro valide tu transferencia, el pago queda registrado. Esta pantalla se actualiza sola.'
              : 'Cuando el centro valide tu transferencia, tu hora queda confirmada. Esta pantalla se actualiza sola.'}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={entrada}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={elegir}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
          <Button variant="secondary" icon="upload" loading={subir.isPending} onClick={() => entrada.current?.click()}>
            {estado.comprobanteRecibido ? 'Subir otro comprobante' : 'Subir comprobante (opcional)'}
          </Button>
          <span className="text-[12.5px] font-semibold text-neutral-700">PDF, PNG o JPEG.</span>
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
      </section>
    </>
  );
}

function PagoEnLinea({ camino, estado, monto }: { camino: CaminoPago; estado: EstadoConfirmacion; monto: number }) {
  const [cobro, setCobro] = useState<CobroIniciado | null>(null);
  const [error, setError] = useState<string>();
  const iniciar = useMutation({
    mutationFn: () => camino.pasarela(),
    onSuccess: (c) => {
      if (c.simulada) setCobro(c);
      else window.location.assign(c.urlPago);
    },
    onError: (e) => setError(mensaje(e, 'No pudimos iniciar el pago. Intenta de nuevo.')),
  });
  return (
    <section className="flex flex-col gap-4">
      {estado.pasarelaSimulada && (
        <Aviso tono="nota" icono="info" titulo="Modo demostración">
          No se realiza ningún cobro. La pasarela real se configura según el convenio de cada centro.
        </Aviso>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="team" size="lg" icon="credit_card" loading={iniciar.isPending} onClick={() => iniciar.mutate()}>
          Pagar {formatoClp(monto)} en línea
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <PasarelaSimulada cobro={cobro} monto={monto} camino={camino} onCerrar={() => setCobro(null)} />
    </section>
  );
}

/** Pantalla de la pasarela simulada (centro de demostracion): no cobra; quien prueba elige el resultado. */
function PasarelaSimulada({ cobro, monto, camino, onCerrar }: { cobro: CobroIniciado | null; monto: number; camino: CaminoPago; onCerrar: () => void }) {
  const cliente = useQueryClient();
  const [error, setError] = useState<string>();
  const pagar = useMutation({
    mutationFn: (pagado: boolean) => datos(api.POST('/api/publico/pasarela/simulada', { body: { referencia: cobro!.referencia, pagado } })),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: ['pago', ...camino.clave] });
      onCerrar();
    },
    onError: (e) => setError(mensaje(e, 'La pasarela simulada no respondió.')),
  });
  return (
    <Modal
      abierto={!!cobro}
      onCerrar={onCerrar}
      titulo="Pasarela de pago (demostración)"
      descripcion="Modo demostración: no se realiza ningún cobro. Elige el resultado del pago para ver cómo sigue el flujo."
      acciones={
        <>
          <Button variant="ghost" onClick={() => pagar.mutate(false)} disabled={pagar.isPending}>
            Simular pago rechazado
          </Button>
          <Button variant="team" icon="check" loading={pagar.isPending} onClick={() => pagar.mutate(true)}>
            Simular pago aprobado
          </Button>
        </>
      }
    >
      <p className="m-0 text-[15px] font-bold">Monto: {formatoClp(monto)}</p>
      {error && (
        <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </Modal>
  );
}
