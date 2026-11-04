'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment, useState, type ReactNode } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Interruptor } from '@/components/ui/Interruptor';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { useConfiguracionCentro, useDirectorioEquipo, type ConfiguracionCentro } from '@/lib/centro';
import type { Icono } from '@/lib/iconos';
import { IVA_PORCENTAJE, RETENCION_HONORARIOS } from '@/lib/tributario';

import { BarraGuardado } from './BarraGuardado';

type Numerico =
  | 'recordatorioHorasAntes'
  | 'plazoAvisoCancelacionHoras'
  | 'penalizacionCancelacionPorcentaje'
  | 'cobroInasistenciaPorcentaje'
  | 'comisionCentroPorcentaje'
  | 'horasPlazoPagoEquipo'
  | 'diasGraciaMorosidad'
  | 'margenTrasladoMin'
  | 'minutosRetencionSolicitud'
  | 'plazoRespuestaDerivacionHoras'
  | 'plazoConsentimientoHoras'
  | 'plazoOposicionHoras'
  | 'diasGraciaCierre'
  | 'edadMinimaCuenta'
  | 'retencionMensajesDias';

interface Campo {
  k: Numerico;
  etiqueta: string;
  unidad: string;
  min: number;
  max: number;
  ayuda?: string;
}

type IdGrupo = 'reservas' | 'clinico' | 'cuentas' | 'comisiones' | 'cancelaciones';

/** Grupos del diseño "Opcion A submenu agrupado": Agenda y plazos (3) y Cobros y comisiones (2). */
const GRUPOS: { id: IdGrupo; titulo: string; bajada: string; campos: Campo[] }[] = [
  {
    id: 'reservas',
    titulo: 'Reservas y recordatorios',
    bajada: 'Para la página pública y los avisos por correo.',
    campos: [
      {
        k: 'recordatorioHorasAntes',
        etiqueta: 'Recordatorio antes de la sesión',
        unidad: 'horas',
        min: 0,
        max: 168,
        ayuda: '0 = sin recordatorio. Debe ser mayor que el aviso mínimo para cancelar.',
      },
      { k: 'margenTrasladoMin', etiqueta: 'Margen entre sesión presencial y online', unidad: 'min', min: 0, max: 240 },
      { k: 'minutosRetencionSolicitud', etiqueta: 'Retención de la hora mientras se verifica el correo', unidad: 'min', min: 5, max: 120 },
    ],
  },
  {
    id: 'clinico',
    titulo: 'Plazos clínicos',
    bajada: 'Derivaciones, consentimientos y cierre de sesiones.',
    campos: [
      { k: 'plazoRespuestaDerivacionHoras', etiqueta: 'Plazo para responder una derivación', unidad: 'horas', min: 1, max: 720 },
      { k: 'plazoConsentimientoHoras', etiqueta: 'Plazo para responder un consentimiento', unidad: 'horas', min: 1, max: 720 },
      { k: 'plazoOposicionHoras', etiqueta: 'Plazo de oposición del paciente', unidad: 'horas', min: 1, max: 720 },
      { k: 'diasGraciaCierre', etiqueta: 'Días para registrar la evolución de una sesión', unidad: 'días', min: 1, max: 365 },
    ],
  },
  {
    id: 'cuentas',
    titulo: 'Cuentas y conservación',
    bajada: 'Cuentas propias de pacientes y mensajes internos del equipo.',
    campos: [
      { k: 'edadMinimaCuenta', etiqueta: 'Edad mínima para la cuenta propia del paciente', unidad: 'años', min: 14, max: 18 },
      { k: 'retencionMensajesDias', etiqueta: 'Conservación de mensajes internos del equipo', unidad: 'días', min: 30, max: 3650 },
    ],
  },
  {
    id: 'comisiones',
    titulo: 'Comisiones del acuerdo por defecto',
    bajada: 'Se descuentan en la liquidación de cada profesional.',
    campos: [
      {
        k: 'comisionCentroPorcentaje',
        etiqueta: 'Comisión del centro sobre lo cobrado',
        unidad: '%',
        min: 0,
        max: 100,
        ayuda: 'Sobre todas las atenciones liquidadas.',
      },
    ],
  },
  {
    id: 'cancelaciones',
    titulo: 'Cancelaciones, inasistencias y deudas',
    bajada: 'Iguales para todo el centro. Se aplican al resolver cancelaciones y al calcular liquidaciones.',
    campos: [
      { k: 'plazoAvisoCancelacionHoras', etiqueta: 'Aviso mínimo para cancelar sin cargo', unidad: 'horas', min: 0, max: 720 },
      { k: 'penalizacionCancelacionPorcentaje', etiqueta: 'Cargo por cancelar fuera de plazo', unidad: '%', min: 0, max: 100 },
      { k: 'cobroInasistenciaPorcentaje', etiqueta: 'Cargo por inasistencia', unidad: '%', min: 0, max: 100 },
      {
        k: 'horasPlazoPagoEquipo',
        etiqueta: 'Pago previo de las horas que agenda el equipo',
        unidad: 'horas',
        min: 0,
        max: 168,
        ayuda: 'Horas antes de la sesión. Si vence sin pago, la hora se mantiene y se paga en el centro.',
      },
      {
        k: 'diasGraciaMorosidad',
        etiqueta: 'Días de gracia antes de contar una deuda',
        unidad: 'días',
        min: 0,
        max: 90,
        ayuda: 'Días después de una sesión impaga. 0 = la deuda cuenta apenas termina la sesión.',
      },
    ],
  },
];

const GRUPOS_SECCION: Record<'agenda' | 'cobros', IdGrupo[]> = { agenda: ['reservas', 'clinico', 'cuentas'], cobros: ['comisiones', 'cancelaciones'] };

export const MODULOS: { id: ConfiguracionCentro['modulosActivos'][number]; nombre: string; icono: Icono; nota: string }[] = [
  { id: 'PAGINA_PUBLICA', nombre: 'Página pública del centro', icono: 'public', nota: 'Sitio con equipo, servicios y contacto' },
  { id: 'FICHAS', nombre: 'Fichas y Pacientes', icono: 'folder_shared', nota: 'Fichas clínicas con acceso restringido por profesional' },
  { id: 'AGENDA', nombre: 'Agenda y Espacios', icono: 'calendar_month', nota: 'Reservas por box y disponibilidad del equipo' },
  { id: 'EQUIPO', nombre: 'Equipo', icono: 'groups', nota: 'Perfiles, especialidades y roles del centro' },
  { id: 'MATCH', nombre: 'Match Terapéutico', icono: 'join', nota: 'Cuestionario público que recomienda profesionales' },
  { id: 'COBROS', nombre: 'Cobros', icono: 'payments', nota: 'Pagos, comprobantes y liquidaciones por profesional' },
  { id: 'WHATSAPP', nombre: 'Avisos por WhatsApp', icono: 'chat', nota: 'Los pacientes pueden aceptar avisos de sus horas por WhatsApp' },
];

/** 03b-4.2 (C-10): comision de las sesiones de pacientes que llegaron por el centro. */
const DERIVACION: { valor: ConfiguracionCentro['comisionDerivacionTipo']; texto: string }[] = [
  { valor: 'GENERAL', texto: 'La misma comisión general' },
  { valor: 'PORCENTAJE', texto: 'Un porcentaje distinto' },
  { valor: 'MONTO_FIJO', texto: 'Un monto fijo por sesión' },
];

/** Diseño: tarjetas de modelo de cobro (letra + titulo + descripcion). Los textos siguen lo que hace la API. */
/**
 * Diseño: tarjetas del acuerdo por defecto (modeloCobro del centro). Lo usan
 * los profesionales sin acuerdo propio; cada acuerdo se ajusta por persona.
 */
const MODELOS: { valor: ConfiguracionCentro['modeloCobro']; letra: string; titulo: string; texto: string; nota: string }[] = [
  {
    valor: 'DIRECTO',
    letra: 'A',
    titulo: 'Cobra el profesional',
    texto: 'Paga al centro por uso de box: hora, bloque o bolsa de horas.',
    nota: 'Arriendo, estilo coworking',
  },
  {
    valor: 'CENTRO',
    letra: 'B',
    titulo: 'Cobra el centro',
    texto: 'Descuenta su comisión y liquida el resto al profesional.',
    nota: 'Comisión o revenue share',
  },
  {
    valor: 'MIXTO',
    letra: 'C',
    titulo: 'Mixto',
    texto: 'Combina cuota fija, cargo por box y comisiones (se definen por persona).',
    nota: 'Sin acuerdo propio cobra el centro, salvo quien adhiera al cobro directo.',
  },
];

/**
 * Reglas y parametros del centro. Los porcentajes llegan como texto
 * (Decimal). Los modulos los activa el operador de Vinculos (panel maestro):
 * aca solo se ven. "Descartar" vuelve a los valores guardados.
 */
export function ReglasCentro({
  seccion,
  nombreSeccion,
  acuerdos,
}: {
  seccion: 'agenda' | 'cobros' | 'modulos' | 'roles';
  nombreSeccion?: string;
  /** Cobros: acuerdos por profesional (componente del modulo Cobros que compone la pagina). */
  acuerdos?: ReactNode;
}) {
  const configuracion = useConfiguracionCentro();
  const [descartes, setDescartes] = useState(0);
  return (
    <EstadoConsulta consulta={configuracion}>
      {(c) =>
        seccion === 'modulos' ? (
          <Modulos c={c} />
        ) : seccion === 'roles' ? (
          <Roles c={c} />
        ) : (
          <Parametros
            key={`${seccion}-${c.updatedAt}-${descartes}`}
            c={c}
            seccion={seccion}
            nombreSeccion={nombreSeccion}
            acuerdos={acuerdos}
            onDescartar={() => setDescartes((n) => n + 1)}
          />
        )
      }
    </EstadoConsulta>
  );
}

function useGuardarConfiguracion(onOk?: () => void) {
  const cliente = useQueryClient();
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: (body: components['schemas']['EditarConfiguracionDto']) => datos(api.PATCH('/api/configuracion', { body })),
    onSuccess: () => {
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['configuracion'] });
      onOk?.();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar la configuración.'),
  });
  return { ...m, error, setError };
}

function Parametros({
  c,
  seccion,
  nombreSeccion,
  acuerdos,
  onDescartar,
}: {
  c: ConfiguracionCentro;
  seccion: 'agenda' | 'cobros';
  nombreSeccion?: string;
  acuerdos?: ReactNode;
  onDescartar: () => void;
}) {
  const grupos = GRUPOS.filter((g) => GRUPOS_SECCION[seccion].includes(g.id));
  const campos = grupos.flatMap((g) => g.campos);
  const cobros = seccion === 'cobros';
  const [valores, setValores] = useState<Record<Numerico, string>>(
    () => Object.fromEntries(campos.map((f) => [f.k, String(c[f.k])])) as Record<Numerico, string>,
  );
  const [modelo, setModelo] = useState(c.modeloCobro);
  const [exigeEvolucion, setExigeEvolucion] = useState(c.liquidarExigeEvolucion);
  const [liquidarCargos, setLiquidarCargos] = useState(c.liquidarCargosAProfesional);
  const [bloquearMorosos, setBloquearMorosos] = useState(c.bloquearAgendaMorosos);
  const [derivTipo, setDerivTipo] = useState(c.comisionDerivacionTipo);
  const [derivValor, setDerivValor] = useState(String(Number(c.comisionDerivacionValor)));
  const [guardado, setGuardado] = useState(false);
  const [cambiado, setCambiado] = useState(false);
  const guardar = useGuardarConfiguracion(() => setGuardado(true));
  /** Envuelve un setter: marca la seccion como cambiada y sin guardar. */
  const tocar =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setGuardado(false);
      setCambiado(true);
      set(v);
    };
  const enviar = () => {
    const malo = campos.find((f) => {
      const n = Number(valores[f.k]);
      return valores[f.k] === '' || Number.isNaN(n) || n < f.min || n > f.max;
    });
    if (malo) return guardar.setError(`${malo.etiqueta}: entre ${malo.min} y ${malo.max} ${malo.unidad}.`);
    const numeros = Object.fromEntries(campos.map((f) => [f.k, Number(valores[f.k])])) as Partial<Record<Numerico, number>>;
    if (!cobros) return guardar.mutate(numeros);
    const valorDeriv = derivTipo === 'GENERAL' ? 0 : Number(derivValor);
    if (derivTipo === 'PORCENTAJE' && (derivValor === '' || Number.isNaN(valorDeriv) || valorDeriv > 100))
      return guardar.setError('Comisión de pacientes del centro: entre 0 y 100 %.');
    if (derivTipo === 'MONTO_FIJO' && (derivValor === '' || !Number.isInteger(valorDeriv) || valorDeriv > 1_000_000))
      return guardar.setError('Comisión de pacientes del centro: un monto en pesos, sin decimales, hasta $1.000.000.');
    guardar.mutate({
      ...numeros,
      comisionDerivacionTipo: derivTipo,
      comisionDerivacionValor: valorDeriv,
      modeloCobro: modelo,
      liquidarExigeEvolucion: exigeEvolucion,
      liquidarCargosAProfesional: liquidarCargos,
      bloquearAgendaMorosos: bloquearMorosos,
    });
  };
  const camposDe = (g: (typeof GRUPOS)[number]) =>
    g.campos.map((f) => (
      <Field key={f.k} label={f.etiqueta} hint={f.ayuda ?? `Entre ${f.min} y ${f.max} ${f.unidad}.`}>
        {(x) => (
          <span className="flex items-center gap-2">
            <Input
              {...x}
              inputMode="decimal"
              value={valores[f.k]}
              onChange={(e) => tocar(setValores)({ ...valores, [f.k]: e.target.value.replace(/[^\d.]/g, '') })}
              className="!w-[110px]"
            />
            <span className="text-[13px] font-bold text-neutral-700">{f.unidad}</span>
          </span>
        )}
      </Field>
    ));
  const interruptores: [string, string, boolean, (v: boolean) => void][] = [
    [
      'Liquidar solo sesiones con evolución registrada',
      'Una sesión realizada sin evolución no entra en la liquidación hasta que el profesional la cierre.',
      exigeEvolucion,
      setExigeEvolucion,
    ],
    [
      'Liquidar al profesional los cargos cobrados',
      'Lo cobrado por inasistencia y cancelación fuera de plazo entra a la liquidación como línea aparte, con la comisión normal. Apagado, lo retiene el centro.',
      liquidarCargos,
      setLiquidarCargos,
    ],
    [
      'No agendar a pacientes con deuda',
      'Con una sesión impaga, ni el paciente ni el profesional pueden agendar la siguiente. Administración o gestión pueden autorizar una hora indicando el motivo.',
      bloquearMorosos,
      setBloquearMorosos,
    ],
  ];
  return (
    <div className="flex flex-col gap-[18px]">
      {cobros && (
        <>
          <Aviso tono="exito" icono="info">
            Vinculos registra, calcula y conecta. El dinero pasa por la cuenta del centro o de cada profesional, y las boletas las emite su titular.
          </Aviso>
          <Panel
            titulo="Acuerdo por defecto"
            bajada="Lo usan los profesionales sin acuerdo propio (y los que se suman al equipo). Después cada acuerdo se ajusta por persona."
            nivel={3}
          >
            <div role="radiogroup" aria-label="Acuerdo por defecto" className="grid gap-3 md:grid-cols-3">
              {MODELOS.map((m) => {
                const elegido = modelo === m.valor;
                return (
                  <button
                    key={m.valor}
                    type="button"
                    role="radio"
                    aria-checked={elegido}
                    onClick={() => tocar(setModelo)(m.valor)}
                    className={`flex cursor-pointer flex-col gap-1.5 rounded-[14px] p-3.5 text-left transition-colors duration-200 ease-out ${
                      elegido ? 'border-2 border-accent-700 bg-accent-100' : 'border border-divider bg-bg hover:border-accent-500'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-flex size-7 items-center justify-center rounded-full bg-text text-[13px] font-extrabold text-neutral-100">
                        {m.letra}
                      </span>
                      <strong className="text-[15px]">{m.titulo}</strong>
                    </span>
                    <span className="text-[13px] font-semibold text-neutral-800">{m.texto}</span>
                    <span className="text-[12px] font-semibold text-neutral-700">{m.nota}</span>
                  </button>
                );
              })}
            </div>
          </Panel>
        </>
      )}
      {grupos.map((g) => (
        <Fragment key={g.id}>
          <Panel id={g.id} titulo={g.titulo} bajada={g.bajada} nivel={3}>
            <div className={`grid gap-4 sm:grid-cols-2 ${g.campos.length > 2 ? 'xl:grid-cols-3' : ''}`}>
              {camposDe(g)}
              {g.id === 'comisiones' && (
                <>
                  <Field
                    label="Comisión de pacientes que llegaron por el centro"
                    hint="Pacientes del sitio público (Match o Pedir hora) o dados de alta por administración. Se marca en la ficha del paciente."
                  >
                    {(x) => (
                      <Select {...x} value={derivTipo} onChange={(e) => tocar(setDerivTipo)(e.target.value as typeof derivTipo)}>
                        {DERIVACION.map((d) => (
                          <option key={d.valor} value={d.valor}>
                            {d.texto}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  {derivTipo !== 'GENERAL' && (
                    <Field
                      label={derivTipo === 'PORCENTAJE' ? 'Porcentaje por sesión' : 'Monto por sesión'}
                      hint={
                        derivTipo === 'PORCENTAJE' ? 'Sobre lo cobrado de cada sesión, entre 0 y 100 %.' : 'En pesos. Nunca más que lo cobrado de la sesión.'
                      }
                    >
                      {(x) => (
                        <span className="flex items-center gap-2">
                          {derivTipo === 'MONTO_FIJO' && <span className="text-[13px] font-bold text-neutral-700">$</span>}
                          <Input
                            {...x}
                            inputMode={derivTipo === 'PORCENTAJE' ? 'decimal' : 'numeric'}
                            value={derivValor}
                            onChange={(e) => tocar(setDerivValor)(e.target.value.replace(derivTipo === 'PORCENTAJE' ? /[^\d.]/g : /\D/g, ''))}
                            className="!w-[110px]"
                          />
                          {derivTipo === 'PORCENTAJE' && <span className="text-[13px] font-bold text-neutral-700">%</span>}
                        </span>
                      )}
                    </Field>
                  )}
                </>
              )}
            </div>
            {g.id === 'cancelaciones' && (
              <div className="mt-4 flex flex-col">
                {interruptores.map(([etiqueta, descripcion, activo, set]) => (
                  <div key={etiqueta} className="border-t border-divider py-3">
                    <Interruptor tono="team" etiqueta={etiqueta} descripcion={descripcion} activo={activo} onChange={tocar(set)} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
          {g.id === 'comisiones' && acuerdos}
          {g.id === 'cancelaciones' && <ParametrosTributarios />}
        </Fragment>
      ))}
      <BarraGuardado
        seccion={nombreSeccion ?? 'esta sección'}
        error={guardar.error}
        guardado={guardado}
        cambiado={cambiado}
        guardando={guardar.isPending}
        onDescartar={onDescartar}
        onGuardar={enviar}
      />
    </div>
  );
}

/** Diseño: retencion de honorarios por año e IVA del box (solo para los calculos informativos). */
function ParametrosTributarios() {
  return (
    <section
      aria-labelledby="parametros-tributarios"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-divider bg-neutral-100 p-5 shadow-sm"
    >
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-1">
        <h3 id="parametros-tributarios" className="m-0 text-[17px] font-black">
          Parámetros tributarios
        </h3>
        <span className="text-[12px] font-semibold text-neutral-700">Solo para los cálculos informativos. Los mantiene Vinculos según la ley vigente.</span>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {RETENCION_HONORARIOS.map((r, i) => (
          <li key={r.anio} className={`rounded-[12px] px-3 py-2 text-[13px] ${i === 0 ? 'bg-text text-neutral-100' : 'border border-divider bg-bg'}`}>
            <strong>{r.anio}</strong> · {i === 0 ? 'retención ' : ''}
            {String(r.porcentaje).replace('.', ',')}%
          </li>
        ))}
        <li className="rounded-[12px] border border-divider bg-bg px-3 py-2 text-[13px]">
          <strong>IVA</strong> · {IVA_PORCENTAJE}% (arriendo de box amoblado)
        </li>
      </ul>
    </section>
  );
}

function Modulos({ c }: { c: ConfiguracionCentro }) {
  return (
    <Panel
      titulo="Módulos contratados"
      bajada="Los activa Vinculos según lo contratado. Para sumar uno, escríbenos: la activación no es automática."
      accion={<Badge>{`${c.modulosActivos.length} de ${MODULOS.length} activos`}</Badge>}
      nivel={3}
    >
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {MODULOS.map((m) => {
          const activo = c.modulosActivos.includes(m.id);
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-divider bg-bg px-3 py-2.5">
              <Icon name={m.icono} size={20} className={activo ? 'text-accent-2-800' : 'text-neutral-700'} />
              <span className="flex min-w-0 flex-[1_1_240px] flex-col">
                <strong className="text-[14px]">{m.nombre}</strong>
                <span className="text-[12px] font-semibold text-neutral-700">{m.nota}</span>
              </span>
              <Badge tono={activo ? 'positivo' : 'neutro'}>{activo ? 'Activo' : 'No contratado'}</Badge>
              {!activo && (
                <button
                  type="button"
                  disabled
                  title="La solicitud en línea aún no está disponible: escríbenos para contratarlo."
                  className="min-h-9 cursor-not-allowed rounded-full border border-divider bg-surface px-3.5 text-[13px] font-extrabold opacity-60"
                >
                  Solicitar
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const JERARQUIA: { rol: 'ADMIN' | 'GESTION' | 'PROFESIONAL' | 'PRACTICANTE'; nombre: string; texto: string }[] = [
  { rol: 'ADMIN', nombre: 'Cuenta madre', texto: 'Configuración, cobros, equipo y la vista administrativa de fichas.' },
  { rol: 'GESTION', nombre: 'Gestión', texto: 'Agenda, recepción y cobros del día a día, sin Configuración.' },
  { rol: 'PROFESIONAL', nombre: 'Profesional', texto: 'Sus pacientes, su agenda y sus fichas. Otras fichas solo por derivación o acceso temporal.' },
  { rol: 'PRACTICANTE', nombre: 'Practicante', texto: 'Con fecha de término, bajo supervisión y con consentimiento del paciente.' },
];

function Roles({ c }: { c: ConfiguracionCentro }) {
  const guardar = useGuardarConfiguracion();
  const equipo = useDirectorioEquipo(true);
  const personas = (rol: string) => equipo.data?.filter((m) => (m.roles as string[]).includes(rol)).length;
  return (
    <div className="flex flex-col gap-[18px]">
      <Panel titulo="Jerarquía de accesos" bajada="Ningún rol administrativo ve contenido clínico." nivel={3}>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {JERARQUIA.map((r) => {
            const n = personas(r.rol);
            return (
              <li key={r.rol} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-divider bg-bg px-3 py-2.5">
                <span className="flex min-w-0 flex-[1_1_260px] flex-col">
                  <strong className="text-[14px]">{r.nombre}</strong>
                  <span className="text-[12px] font-semibold text-neutral-700">{r.texto}</span>
                </span>
                {n !== undefined && <Badge tono="neutro">{`${n} ${n === 1 ? 'persona' : 'personas'}`}</Badge>}
              </li>
            );
          })}
        </ul>
        <Link
          href="/admin/equipo"
          className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded-full bg-text px-[18px] text-[13.5px] font-extrabold text-neutral-100 hover:text-neutral-100"
        >
          <Icon name="groups" size={17} />
          Ver personas en Equipo
        </Link>
      </Panel>
      <Panel titulo="Opciones" nivel={3}>
        <div>
          <Interruptor
            tono="team"
            etiqueta="Habilitar el rol de gestión"
            descripcion="Para centros con recepción o coordinación administrativa. Si se desactiva, deja de estar disponible."
            activo={c.rolGestionHabilitado}
            deshabilitado={guardar.isPending}
            onChange={(v) => guardar.mutate({ rolGestionHabilitado: v })}
          />
          {guardar.error && (
            <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-700">
              {guardar.error}
            </p>
          )}
        </div>
      </Panel>
    </div>
  );
}
