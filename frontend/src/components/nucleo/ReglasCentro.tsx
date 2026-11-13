'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useCuentasEquipo } from '@/lib/equipo';
import { Button } from '@/components/ui/Button';
import { useMiCuenta } from '@/lib/consultas';
import type { Icono } from '@/lib/iconos';
import { IVA_PORCENTAJE, RETENCION_HONORARIOS } from '@/lib/tributario';

import { BarraGuardado } from './BarraGuardado';
import { AccionSolicitud, abiertaDe, HistorialSolicitudes, useSolicitudesModulo } from './SolicitudesModulo';

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
  | 'horasAprobacionSolicitud'
  | 'plazoRespuestaDerivacionHoras'
  | 'plazoConsentimientoHoras'
  | 'plazoOposicionHoras'
  | 'diasGraciaCierre'
  | 'edadMinimaCuenta'
  | 'maxCuentasMadre'
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
      {
        k: 'horasAprobacionSolicitud',
        etiqueta: 'Plazo del profesional para aprobar una hora pedida',
        unidad: 'horas',
        min: 1,
        max: 168,
        ayuda: 'Corre desde que el paciente verifica su correo; nunca pasa del inicio de la sesión. Si vence, la hora se libera y se avisa al paciente.',
      },
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
    bajada: 'Cuentas madre del equipo, cuentas propias de pacientes y mensajes internos.',
    campos: [
      {
        k: 'maxCuentasMadre',
        etiqueta: 'Máximo de cuentas madre',
        unidad: 'cuentas',
        min: 1,
        max: 10,
        ayuda: 'Entre 1 y 10. El resto del equipo combina gestión y profesional. Para bajarlo, primero quita el rol a quien sobre.',
      },
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
  // MVP (2026-11-11): Cobros y avisos por WhatsApp fuera para todos los centros; no se muestran (vuelven con la implementacion futura).
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
    () => Object.fromEntries(campos.map((f) => [f.k, String(c[f.k] ?? '')])) as Record<Numerico, string>,
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
    <section aria-labelledby="parametros-tributarios" className="flex flex-wrap items-center gap-4 rounded-lg border border-divider bg-bg p-5 shadow-suave">
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

/**
 * Tarea 31: el ADMIN solicita activar o desactivar un modulo; Vinculos lo
 * revisa y lo aplica (la activacion no es automatica). El estado de cada
 * solicitud llega con el polling global.
 */
function Modulos({ c }: { c: ConfiguracionCentro }) {
  const solicitudes = useSolicitudesModulo();
  return (
    <Panel
      titulo="Módulos contratados"
      bajada="Los activa Vinculos según lo contratado. Solicita uno aquí: lo revisamos y te avisamos el estado en esta misma lista."
      accion={<Badge>{`${MODULOS.filter((m) => c.modulosActivos.includes(m.id)).length} de ${MODULOS.length} activos`}</Badge>}
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
              <AccionSolicitud modulo={m.id} nombre={m.nombre} activo={activo} activos={c.modulosActivos} abierta={abiertaDe(solicitudes.data, m.id)} />
            </li>
          );
        })}
      </ul>
      <HistorialSolicitudes lista={solicitudes.data ?? []} nombre={nombreModulo} />
    </Panel>
  );
}

const JERARQUIA: { rol: 'ADMIN' | 'GESTION' | 'PROFESIONAL' | 'PRACTICANTE'; nombre: string; texto: string }[] = [
  { rol: 'ADMIN', nombre: 'Cuenta madre', texto: 'Configuración, equipo y el seguimiento del trabajo de cada profesional, sin ver pacientes.' },
  { rol: 'GESTION', nombre: 'Gestión', texto: 'Agenda y recepción del día a día (datos administrativos de pacientes), sin Configuración.' },
  { rol: 'PROFESIONAL', nombre: 'Profesional', texto: 'Sus pacientes, su agenda y sus fichas. Otras fichas solo por derivación o acceso temporal.' },
  { rol: 'PRACTICANTE', nombre: 'Practicante', texto: 'Con fecha de término, bajo supervisión y con consentimiento del paciente.' },
];

function Roles({ c }: { c: ConfiguracionCentro }) {
  const guardar = useGuardarConfiguracion();
  const equipo = useDirectorioEquipo(true);
  // Punto 35: cuantas personas tiene cada rol y, al tocarlo, sus nombres (lista simple) con asignacion rapida.
  const conRol = (rol: string) => equipo.data?.filter((m) => (m.roles as string[]).includes(rol));
  const [abierto, setAbierto] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-[18px]">
      <Panel titulo="Jerarquía de accesos" bajada="Ningún rol administrativo ve contenido clínico." nivel={3}>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {JERARQUIA.map((r) => {
            const lista = conRol(r.rol);
            const n = lista?.length;
            const visible = abierto === r.rol;
            return (
              <li key={r.rol} className="rounded-[12px] border border-divider bg-bg">
                <button
                  type="button"
                  aria-expanded={visible}
                  disabled={!n}
                  onClick={() => setAbierto(visible ? null : r.rol)}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-3 px-3 py-2.5 text-left disabled:cursor-default"
                >
                  <span className="flex min-w-0 flex-[1_1_260px] flex-col">
                    <strong className="text-[14px]">{r.nombre}</strong>
                    <span className="text-[12px] font-semibold text-neutral-700">{r.texto}</span>
                  </span>
                  {n !== undefined && <Badge tono="neutro">{`${n} ${n === 1 ? 'persona' : 'personas'}`}</Badge>}
                  {!!n && <Icon name={visible ? 'expand_less' : 'expand_more'} size={18} />}
                </button>
                {visible && <PersonasDelRol rol={r.rol} />}
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
      <PerfilesRol />
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

const COMBINABLES = ['ADMIN', 'GESTION', 'PROFESIONAL'];

/**
 * Punto 35: quienes tienen el rol y asignacion rapida (mismas reglas que la
 * ficha en Equipo: el rol principal no se cambia aqui; cuenta madre y gestion
 * se agregan y quitan al instante; el profesional adicional se da de baja con
 * fecha desde su ficha; el practicante es exclusivo; nadie se quita un rol a
 * si mismo; el cupo de cuentas madre lo valida la BD).
 */
function PersonasDelRol({ rol }: { rol: 'ADMIN' | 'GESTION' | 'PROFESIONAL' | 'PRACTICANTE' }) {
  const cliente = useQueryClient();
  const cuentas = useCuentasEquipo(true);
  const yo = useMiCuenta();
  const [agregar, setAgregar] = useState('');
  const [aviso, setAviso] = useState<{ ok?: string; error?: string }>({});
  const listo = (ok: string) => {
    setAviso({ ok });
    setAgregar('');
    void cliente.invalidateQueries({ queryKey: ['equipo', 'cuentas'] });
    void cliente.invalidateQueries({ queryKey: ['directorio'] });
  };
  const fallo = (e: unknown) => setAviso({ error: e instanceof ApiError ? e.message : 'No pudimos cambiar el rol.' });
  const otorgar = useMutation({
    mutationFn: (id: string) =>
      datos(api.POST('/api/usuarios/{id}/roles', { params: { path: { id } }, body: { rol: rol as 'ADMIN' | 'GESTION' | 'PROFESIONAL' } })),
    onSuccess: () => listo('Rol agregado. Lo usa desde su próximo ingreso.'),
    onError: fallo,
  });
  const quitar = useMutation({
    mutationFn: (id: string) => datos(api.POST('/api/usuarios/{id}/roles/retiro', { params: { path: { id } }, body: { rol: rol as 'ADMIN' | 'GESTION' } })),
    onSuccess: () => listo('Rol quitado: sus sesiones con ese rol se cerraron.'),
    onError: fallo,
  });
  const activas = (cuentas.data ?? []).filter((c) => c.activo && !c.cerradaEn);
  const con = activas.filter((c) => c.rol === rol || c.rolesAdicionales.some((r) => r.rol === rol && r.activo));
  const candidatas = COMBINABLES.includes(rol)
    ? activas.filter((c) => COMBINABLES.includes(c.rol) && c.rol !== rol && !c.rolesAdicionales.some((r) => r.rol === rol && r.activo))
    : [];
  return (
    <div className="flex flex-col gap-2.5 border-t border-divider px-3 py-2.5">
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {con.map((c) => {
          const principal = c.rol === rol;
          const quitable = !principal && (rol === 'ADMIN' || rol === 'GESTION') && c.id !== yo.data?.id;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-[10px] px-2 py-1.5 hover:bg-lienzo">
              <span className="min-w-0 flex-1 text-[13.5px] font-bold">{c.nombre ?? 'Sin nombre'}</span>
              <Badge tono="neutro">{principal ? 'principal' : 'adicional'}</Badge>
              {quitable && (
                <Button
                  variant="ghost"
                  icon="close"
                  loading={quitar.isPending && quitar.variables === c.id}
                  onClick={() => quitar.mutate(c.id)}
                  className="!min-h-8 !px-2.5 !py-1 !text-[12.5px]"
                >
                  Quitar
                </Button>
              )}
              {!principal && rol === 'PROFESIONAL' && (
                <Link href={`/admin/equipo?id=${c.id}`} className="text-[12.5px] font-extrabold">
                  Dar de baja en su ficha
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {candidatas.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Agregar a alguien del equipo">
            {(p) => (
              <Select {...p} value={agregar} onChange={(e) => setAgregar(e.target.value)} className="!py-2 text-[13.5px]">
                <option value="">Elige una persona</option>
                {candidatas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre ?? 'Sin nombre'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="team" icon="add" disabled={!agregar} loading={otorgar.isPending} onClick={() => otorgar.mutate(agregar)} className="!py-2.5">
            Agregar
          </Button>
        </div>
      )}
      {rol === 'PRACTICANTE' && (
        <p className="m-0 text-[12px] font-semibold text-neutral-700">El practicante es exclusivo: se crea como cuenta nueva en Equipo.</p>
      )}
      {aviso.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {aviso.error}
        </p>
      )}
      {aviso.ok && !aviso.error && (
        <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
          {aviso.ok}
        </p>
      )}
    </div>
  );
}

type PerfilRol = components['schemas']['PerfilRolVista'];
type ModuloRestringible = 'PAGINA_PUBLICA' | 'FICHAS' | 'AGENDA' | 'EQUIPO' | 'MATCH';
const RESTRINGIBLES: ModuloRestringible[] = ['AGENDA', 'FICHAS', 'EQUIPO', 'MATCH', 'PAGINA_PUBLICA'];
const BASES = [
  { rol: 'GESTION', nombre: 'Gestión' },
  { rol: 'PROFESIONAL', nombre: 'Profesional' },
  { rol: 'ADMIN', nombre: 'Cuenta madre' },
] as const;
const nombreModulo = (m: string) => MODULOS.find((x) => x.id === m)?.nombre ?? m;

/**
 * Punto 36: perfiles sobre un rol base (p. ej. "Recepcion" sobre Gestion).
 * Solo restringen modulos del rol base: nunca dan mas permisos (la base de
 * datos sigue limitando al rol base). Las profesiones (psicologo,
 * nutricionista...) son tipos de profesional, no perfiles.
 */
function PerfilesRol() {
  const cliente = useQueryClient();
  const perfiles = useQuery({ queryKey: ['configuracion', 'perfiles'], queryFn: () => datos(api.GET('/api/perfiles')) });
  const [editando, setEditando] = useState<string | 'nuevo' | null>(null);
  const refrescar = () => void cliente.invalidateQueries({ queryKey: ['configuracion', 'perfiles'] });
  return (
    <Panel
      titulo="Perfiles"
      bajada="Un perfil da nombre a un rol (por ejemplo «Recepción» sobre Gestión) y puede quitarle secciones. Nunca da más permisos que su rol base."
      nivel={3}
    >
      <div className="mt-3 flex flex-col gap-2.5">
        <EstadoConsulta consulta={perfiles} vacio={(l) => l.length === 0 && editando !== 'nuevo'} textoVacio="Todavía no hay perfiles">
          {(lista) => (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {lista.map((p) =>
                editando === p.id ? (
                  <li key={p.id}>
                    <FormularioPerfil inicial={p} onListo={() => setEditando(null)} onGuardado={refrescar} />
                  </li>
                ) : (
                  <TarjetaPerfil key={p.id} perfil={p} onEditar={() => setEditando(p.id)} onCambio={refrescar} />
                ),
              )}
            </ul>
          )}
        </EstadoConsulta>
        {editando === 'nuevo' ? (
          <FormularioPerfil onListo={() => setEditando(null)} onGuardado={refrescar} />
        ) : (
          <Button variant="secondary" icon="add" onClick={() => setEditando('nuevo')} className="self-start !py-2.5">
            Nuevo perfil
          </Button>
        )}
      </div>
    </Panel>
  );
}

function TarjetaPerfil({ perfil: p, onEditar, onCambio }: { perfil: PerfilRol; onEditar: () => void; onCambio: () => void }) {
  const cuentas = useCuentasEquipo(true);
  const [asignar, setAsignar] = useState('');
  const [error, setError] = useState<string>();
  const nombre = new Map((cuentas.data ?? []).map((c) => [c.id, c.nombre ?? 'Sin nombre']));
  // Solo cuentas activas con el rol base (principal o adicional) que aun no tienen este perfil.
  const candidatas = (cuentas.data ?? []).filter(
    (c) => c.activo && !c.cerradaEn && !p.asignados.includes(c.id) && (c.rol === p.rolBase || c.rolesAdicionales.some((r) => r.rol === p.rolBase && r.activo)),
  );
  const fallo = (e: unknown) => setError(e instanceof ApiError ? e.message : 'No pudimos completar la acción.');
  const hecho = () => {
    setError(undefined);
    setAsignar('');
    onCambio();
  };
  const asignarM = useMutation({
    mutationFn: () => datos(api.POST('/api/perfiles/{id}/asignaciones', { params: { path: { id: p.id } }, body: { usuarioId: asignar } })),
    onSuccess: hecho,
    onError: fallo,
  });
  const quitarM = useMutation({
    mutationFn: (usuarioId: string) => datos(api.DELETE('/api/perfiles/{id}/asignaciones/{usuarioId}', { params: { path: { id: p.id, usuarioId } } })),
    onSuccess: hecho,
    onError: fallo,
  });
  const eliminarM = useMutation({
    mutationFn: () => datos(api.DELETE('/api/perfiles/{id}', { params: { path: { id: p.id } } })),
    onSuccess: hecho,
    onError: fallo,
  });
  return (
    <li className="flex flex-col gap-2.5 rounded-[12px] border border-divider bg-bg px-3.5 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col">
          <strong className="text-[14.5px]">{p.nombre}</strong>
          <span className="text-[12px] font-semibold text-neutral-700">
            Sobre {BASES.find((b) => b.rol === p.rolBase)?.nombre ?? p.rolBase}
            {p.descripcion ? ` · ${p.descripcion}` : ''}
          </span>
        </span>
        <Button variant="ghost" icon="edit" onClick={onEditar} className="!min-h-8 !px-2.5 !py-1 !text-[12.5px]">
          Editar
        </Button>
        <Button
          variant="ghost"
          icon="delete"
          disabled={p.asignados.length > 0}
          title={p.asignados.length ? 'Quita el perfil a sus personas antes de eliminarlo' : undefined}
          loading={eliminarM.isPending}
          onClick={() => eliminarM.mutate()}
          className="!min-h-8 !px-2.5 !py-1 !text-[12.5px]"
        >
          Eliminar
        </Button>
      </div>
      <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
        {p.restricciones.length ? `No ve: ${p.restricciones.map(nombreModulo).join(', ')}` : 'Ve todo lo de su rol base'}
      </p>
      <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
        {p.asignados.map((id) => (
          <li key={id} className="inline-flex items-center gap-1 rounded-full bg-neutral-200 py-0.5 pr-0.5 pl-2.5 text-[12.5px] font-bold">
            {nombre.get(id) ?? 'Cuenta'}
            <button
              type="button"
              aria-label={`Quitar el perfil a ${nombre.get(id) ?? 'la cuenta'}`}
              onClick={() => quitarM.mutate(id)}
              className="grid size-6 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
            >
              <Icon name="close" size={14} />
            </button>
          </li>
        ))}
      </ul>
      {candidatas.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Asignar a">
            {(f) => (
              <Select {...f} value={asignar} onChange={(e) => setAsignar(e.target.value)} className="!py-2 text-[13.5px]">
                <option value="">Elige una persona</option>
                {candidatas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre ?? 'Sin nombre'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button variant="team" icon="add" disabled={!asignar} loading={asignarM.isPending} onClick={() => asignarM.mutate()} className="!py-2.5">
            Asignar
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </li>
  );
}

function FormularioPerfil({ inicial, onListo, onGuardado }: { inicial?: PerfilRol; onListo: () => void; onGuardado: () => void }) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? '');
  const [rolBase, setRolBase] = useState<(typeof BASES)[number]['rol']>((inicial?.rolBase as (typeof BASES)[number]['rol']) ?? 'GESTION');
  const [restricciones, setRestricciones] = useState<ModuloRestringible[]>((inicial?.restricciones as ModuloRestringible[]) ?? []);
  const guardar = useMutation({
    mutationFn: () => {
      const body = { nombre: nombre.trim(), descripcion: descripcion.trim() || undefined, rolBase, restricciones };
      return datos(inicial ? api.PATCH('/api/perfiles/{id}', { params: { path: { id: inicial.id } }, body }) : api.POST('/api/perfiles', { body }));
    },
    onSuccess: () => {
      onGuardado();
      onListo();
    },
  });
  const alternar = (m: ModuloRestringible) => setRestricciones((r) => (r.includes(m) ? r.filter((x) => x !== m) : [...r, m]));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (nombre.trim()) guardar.mutate();
      }}
      className="flex flex-col gap-3 rounded-[12px] border border-accent-2-500 bg-accent-2-100 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" required>
          {(f) => <Input {...f} maxLength={60} placeholder="Recepción" value={nombre} onChange={(e) => setNombre(e.target.value)} />}
        </Field>
        <Field label="Rol base" hint="El perfil tiene, como máximo, lo que permite este rol.">
          {(f) => (
            <Select {...f} value={rolBase} disabled={!!inicial?.asignados.length} onChange={(e) => setRolBase(e.target.value as (typeof BASES)[number]['rol'])}>
              {BASES.map((b) => (
                <option key={b.rol} value={b.rol}>
                  {b.nombre}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Descripción (opcional)">
        {(f) => <Input {...f} maxLength={300} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />}
      </Field>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1 text-[12px] font-extrabold text-neutral-800">Secciones que este perfil no ve</legend>
        <div className="flex flex-wrap gap-2">
          {RESTRINGIBLES.map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-divider bg-bg px-3 py-1.5 text-[13px] font-bold">
              <input type="checkbox" checked={restricciones.includes(m)} onChange={() => alternar(m)} className="size-4 accent-accent-2-600" />
              {nombreModulo(m)}
            </label>
          ))}
        </div>
      </fieldset>
      {guardar.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos guardar el perfil.'}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button type="submit" variant="team" disabled={!nombre.trim()} loading={guardar.isPending}>
          {inicial ? 'Guardar cambios' : 'Crear perfil'}
        </Button>
      </div>
    </form>
  );
}
