'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { CampoRut } from '@/components/shared/CampoRut';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Interruptor } from '@/components/ui/Interruptor';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { useConfiguracionCentro, type ConfiguracionCentro } from '@/lib/centro';
import { rutValido } from '@/lib/formato';

type CuentaVista = components['schemas']['CuentaCentroVista'];

const CLAVE_CUENTA = ['panel', 'cobros', 'cuenta-centro'];
const TIPOS_CUENTA = ['Cuenta corriente', 'Cuenta vista', 'Cuenta de ahorro'];

/**
 * Medios con que el paciente confirma su hora y cuenta del centro para
 * transferir (solo ADMIN; diseño "Opcion A submenu agrupado"). El link de pago
 * y las conexiones de cobro se muestran como diseño de ejemplo: la pasarela
 * no tiene adaptador real, asi que no se activan desde aca (si ya estaba
 * habilitada, se conserva tal cual).
 */
export function MediosPagoCentro() {
  const configuracion = useConfiguracionCentro();
  const cuenta = useQuery({ queryKey: CLAVE_CUENTA, queryFn: () => datos(api.GET('/api/cobros/cuenta-centro')) });
  return (
    <EstadoConsulta consulta={configuracion}>
      {(c) => (
        <EstadoConsulta consulta={cuenta}>
          {(k) => (
            <div className="flex flex-col gap-6">
              <Medios key={c.updatedAt} c={c} hayCuenta={!!k} />
              <Cuenta key={k?.updatedAt ?? 'nueva'} cuenta={k ?? null} directo={c.modeloCobro === 'DIRECTO'} />
              <Conexiones cuenta={k ?? null} />
            </div>
          )}
        </EstadoConsulta>
      )}
    </EstadoConsulta>
  );
}

function Medios({ c, hayCuenta }: { c: ConfiguracionCentro; hayCuenta: boolean }) {
  const cliente = useQueryClient();
  const [centro, setCentro] = useState(c.mediosPagoHabilitados.includes('PAGO_EN_CENTRO'));
  const [transferencia, setTransferencia] = useState(c.mediosPagoHabilitados.includes('TRANSFERENCIA'));
  const [plazo, setPlazo] = useState(String(c.plazoValidacionTransferenciaHoras));
  const [porcentaje, setPorcentaje] = useState(String(c.porcentajePagoConfirmacion));
  const [error, setError] = useState<string>();
  const [guardado, setGuardado] = useState(false);
  const guardar = useMutation({
    mutationFn: (body: components['schemas']['EditarConfiguracionDto']) => datos(api.PATCH('/api/configuracion', { body })),
    onSuccess: () => {
      setGuardado(true);
      void cliente.invalidateQueries({ queryKey: ['configuracion'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar los medios de pago.'),
  });
  const enviar = () => {
    const horas = Number(plazo);
    const pct = Number(porcentaje);
    setGuardado(false);
    if (!centro && !transferencia) return setError('Deja al menos un medio de pago activo.');
    if (transferencia && !hayCuenta && c.modeloCobro !== 'DIRECTO') return setError('Registra la cuenta del centro antes de activar la transferencia.');
    if (!Number.isInteger(horas) || horas < 1 || horas > 168) return setError('Plazo para pagar: entre 1 y 168 horas.');
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return setError('Porcentaje para confirmar: entre 1 y 100 %.');
    setError(undefined);
    guardar.mutate({
      mediosPagoHabilitados: [
        ...(centro ? (['PAGO_EN_CENTRO'] as const) : []),
        ...(transferencia ? (['TRANSFERENCIA'] as const) : []),
        ...c.mediosPagoHabilitados.filter((m) => m === 'PASARELA'),
      ],
      plazoValidacionTransferenciaHoras: horas,
      porcentajePagoConfirmacion: pct,
    });
  };
  const cambiar = (set: (v: boolean) => void) => (v: boolean) => {
    setGuardado(false);
    set(v);
  };
  const pasarela = c.mediosPagoHabilitados.includes('PASARELA');
  const tarjetas: { nombre: string; texto: string; activo: boolean; onChange?: (v: boolean) => void; nota?: string }[] = [
    { nombre: 'Pago en el centro', texto: 'La hora se confirma con el correo verificado y se paga al llegar.', activo: centro, onChange: cambiar(setCentro) },
    {
      nombre: 'Transferencia',
      texto: 'El paciente sube su comprobante; la hora se confirma al validarlo en Cobros.',
      activo: transferencia,
      onChange: cambiar(setTransferencia),
    },
    {
      nombre: 'Link de pago',
      texto: 'Tarjeta o transferencia por la pasarela del titular del cobro.',
      activo: pasarela,
      nota: pasarela ? 'Habilitado antes: se conserva' : 'Requiere una conexión activa (aún no disponible)',
    },
  ];
  return (
    <Panel titulo="Lo que ve el paciente al reservar" nivel={3}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-3">
          {tarjetas.map((t) => (
            <div
              key={t.nombre}
              className={`flex flex-col gap-2 rounded-[14px] bg-bg p-3.5 ${t.activo ? 'border-2 border-accent-2-700' : 'border border-divider'}`}
            >
              <Interruptor tono="patient" etiqueta={t.nombre} activo={t.activo} deshabilitado={!t.onChange} onChange={t.onChange ?? (() => undefined)} />
              <span className="text-[12px] font-semibold text-neutral-800">{t.texto}</span>
              <span className={`text-[12px] font-extrabold ${t.activo ? 'text-accent-2-800' : 'text-pendiente-900'}`}>
                {t.nota ?? (t.activo ? 'Visible al reservar' : 'Oculto al reservar')}
              </span>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plazo para pagar o validar" hint="Horas, entre 1 y 168. Nunca después del inicio de la sesión.">
            {(p) => (
              <span className="flex items-center gap-2">
                <Input {...p} inputMode="numeric" value={plazo} onChange={(e) => setPlazo(e.target.value.replace(/\D/g, ''))} className="!w-[110px] !py-2.5" />
                <span className="text-[13px] font-bold text-neutral-700">horas</span>
              </span>
            )}
          </Field>
          <Field label="Porcentaje que se paga para confirmar" hint="Del valor de la sesión, entre 1 y 100 %.">
            {(p) => (
              <span className="flex items-center gap-2">
                <Input
                  {...p}
                  inputMode="numeric"
                  value={porcentaje}
                  onChange={(e) => setPorcentaje(e.target.value.replace(/\D/g, ''))}
                  className="!w-[110px] !py-2.5"
                />
                <span className="text-[13px] font-bold text-neutral-700">%</span>
              </span>
            )}
          </Field>
        </div>
        <Pie error={error} guardado={guardado} cargando={guardar.isPending} onGuardar={enviar} texto="Guardar medios de pago" />
      </div>
    </Panel>
  );
}

/**
 * Conexiones de cobro (diseño de ejemplo): la transferencia del centro es
 * real (sale de la cuenta registrada); la pasarela del centro y las de cada
 * profesional se muestran como quedaran, sin conectarse todavia.
 */
function Conexiones({ cuenta }: { cuenta: CuentaVista | null }) {
  const filas: { titular: string; tipo: string; detalle: string; estado: string; tono: string; accion?: string }[] = [
    {
      titular: cuenta?.titular ?? 'El centro',
      tipo: 'Transferencia',
      detalle: cuenta ? `${cuenta.banco} · ${cuenta.tipoCuenta.toLowerCase()} terminada en ${cuenta.numeroCuenta.slice(-3)}` : 'Sin cuenta registrada',
      estado: cuenta ? 'Activa' : 'Sin cuenta',
      tono: cuenta ? 'bg-accent-2-200 text-accent-2-800' : 'bg-pendiente-100 text-pendiente-900',
    },
    {
      titular: cuenta?.titular ?? 'El centro',
      tipo: 'Pasarela de pago',
      detalle: 'Para las atenciones que cobra el centro (acuerdos B y C).',
      estado: 'Sin conectar',
      tono: 'bg-pendiente-100 text-pendiente-900',
      accion: 'Conectar',
    },
    {
      titular: 'Profesionales con cobro propio',
      tipo: 'Pasarela propia',
      detalle: 'Para sus atenciones (acuerdo A). Cada uno la conecta desde Mi perfil.',
      estado: 'Ejemplo',
      tono: 'bg-neutral-200 text-neutral-800',
    },
  ];
  return (
    <Panel
      titulo="Conexiones de cobro"
      bajada="Cada titular conecta su propia cuenta. Las credenciales se guardan cifradas y no se vuelven a mostrar."
      nivel={3}
    >
      <div className="flex flex-col gap-2.5">
        <Aviso tono="nota" icono="info">
          Diseño de ejemplo: la conexión con pasarelas de pago todavía no está disponible. Hoy el paciente paga en el centro o por transferencia.
        </Aviso>
        {filas.map((f) => (
          <div key={f.tipo} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-divider bg-bg px-3.5 py-3">
            <span className="flex min-w-0 flex-[1_1_200px] flex-col">
              <strong className="text-[14px]">{f.titular}</strong>
              <span className="text-[12px] font-semibold text-neutral-700">{f.tipo}</span>
            </span>
            <span className="flex-[1_1_200px] text-[12px] font-semibold text-neutral-800">{f.detalle}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${f.tono}`}>{f.estado}</span>
            {f.accion && (
              <Button variant="secondary" disabled className="!py-2" title="Aún no disponible">
                {f.accion}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Cuenta({ cuenta, directo }: { cuenta: CuentaVista | null; directo: boolean }) {
  const cliente = useQueryClient();
  const [d, setD] = useState({
    rut: cuenta?.rut ?? '',
    banco: cuenta?.banco ?? '',
    tipoCuenta: cuenta?.tipoCuenta ?? TIPOS_CUENTA[0]!,
    numeroCuenta: cuenta?.numeroCuenta ?? '',
    titular: cuenta?.titular ?? '',
  });
  const [error, setError] = useState<string>();
  const [guardado, setGuardado] = useState(false);
  const guardar = useMutation({
    mutationFn: () => datos(api.PUT('/api/cobros/cuenta-centro', { body: d })),
    onSuccess: () => {
      setGuardado(true);
      void cliente.invalidateQueries({ queryKey: CLAVE_CUENTA });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar la cuenta.'),
  });
  const cambiar = (campo: Partial<typeof d>) => {
    setGuardado(false);
    setD({ ...d, ...campo });
  };
  const enviar = () => {
    if (!rutValido(d.rut)) return setError('El RUT no es válido: revisa el dígito verificador.');
    if (d.banco.trim().length < 2 || d.titular.trim().length < 2) return setError('Completa el banco y el titular.');
    if (!/^[0-9-]{4,30}$/.test(d.numeroCuenta)) return setError('Número de cuenta: solo dígitos y guiones (4 a 30).');
    setError(undefined);
    guardar.mutate();
  };
  return (
    <Panel titulo="Cuenta del centro" bajada="Datos que ve el paciente para transferir. Se guardan cifrados.">
      <div className="mt-4 flex flex-col gap-4">
        {directo && <Aviso tono="info">Con cobro directo cada profesional recibe en la cuenta de sus datos para pagos; esta cuenta no se usa.</Aviso>}
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoRut label="RUT del titular" required value={d.rut} onChange={(rut) => cambiar({ rut })} />
          <Field label="Titular" required>
            {(p) => <Input {...p} maxLength={120} value={d.titular} onChange={(e) => cambiar({ titular: e.target.value })} />}
          </Field>
          <Field label="Banco" required>
            {(p) => <Input {...p} maxLength={80} value={d.banco} onChange={(e) => cambiar({ banco: e.target.value })} />}
          </Field>
          <Field label="Tipo de cuenta" required>
            {(p) => (
              <Select {...p} value={d.tipoCuenta} onChange={(e) => cambiar({ tipoCuenta: e.target.value })}>
                {[...new Set([...TIPOS_CUENTA, d.tipoCuenta])].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Número de cuenta" required>
            {(p) => <Input {...p} inputMode="numeric" maxLength={30} value={d.numeroCuenta} onChange={(e) => cambiar({ numeroCuenta: e.target.value })} />}
          </Field>
        </div>
        <Pie error={error} guardado={guardado} cargando={guardar.isPending} onGuardar={enviar} texto="Guardar cuenta" />
      </div>
    </Panel>
  );
}

function Pie({ error, guardado, cargando, onGuardar, texto }: { error?: string; guardado: boolean; cargando: boolean; onGuardar: () => void; texto: string }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {error && (
        <p role="alert" className="m-0 mr-auto text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
      {guardado && !error && (
        <p role="status" className="m-0 mr-auto text-[13px] font-bold text-accent-2-800">
          Cambios guardados.
        </p>
      )}
      <Button variant="team" icon="save" loading={cargando} onClick={onGuardar}>
        {texto}
      </Button>
    </div>
  );
}
