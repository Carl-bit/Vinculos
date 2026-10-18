'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Interruptor } from '@/components/ui/Interruptor';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { useConfiguracionCentro, type ConfiguracionCentro } from '@/lib/centro';
import type { Icono } from '@/lib/iconos';

type Numerico =
  | 'recordatorioHorasAntes'
  | 'plazoAvisoCancelacionHoras'
  | 'penalizacionCancelacionPorcentaje'
  | 'cobroInasistenciaPorcentaje'
  | 'comisionCentroPorcentaje'
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

const GRUPOS: { id: string; titulo: string; bajada: string; campos: Campo[] }[] = [
  {
    id: 'cobros',
    titulo: 'Cobros y cancelaciones',
    bajada: 'Se aplican al registrar inasistencias, resolver cancelaciones y generar liquidaciones.',
    campos: [
      { k: 'plazoAvisoCancelacionHoras', etiqueta: 'Aviso mínimo para cancelar sin cargo', unidad: 'horas', min: 0, max: 720 },
      { k: 'penalizacionCancelacionPorcentaje', etiqueta: 'Cargo por cancelar fuera de plazo', unidad: '%', min: 0, max: 100 },
      { k: 'cobroInasistenciaPorcentaje', etiqueta: 'Cargo por inasistencia', unidad: '%', min: 0, max: 100 },
      {
        k: 'comisionCentroPorcentaje',
        etiqueta: 'Comisión del centro sobre lo cobrado',
        unidad: '%',
        min: 0,
        max: 100,
        ayuda: 'Se descuenta en la liquidación de cada profesional.',
      },
    ],
  },
  {
    id: 'agenda',
    titulo: 'Agenda y recordatorios',
    bajada: 'Reservas desde la página pública y avisos al paciente (por correo).',
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
    titulo: 'Plazos clínicos y de cuentas',
    bajada: 'Derivaciones, consentimientos, cierre de sesiones y cuentas de pacientes.',
    campos: [
      { k: 'plazoRespuestaDerivacionHoras', etiqueta: 'Plazo para responder una derivación', unidad: 'horas', min: 1, max: 720 },
      { k: 'plazoConsentimientoHoras', etiqueta: 'Plazo para responder un consentimiento', unidad: 'horas', min: 1, max: 720 },
      { k: 'plazoOposicionHoras', etiqueta: 'Plazo de oposición del paciente', unidad: 'horas', min: 1, max: 720 },
      { k: 'diasGraciaCierre', etiqueta: 'Días para registrar la evolución de una sesión', unidad: 'días', min: 1, max: 365 },
      { k: 'edadMinimaCuenta', etiqueta: 'Edad mínima para la cuenta propia del paciente', unidad: 'años', min: 14, max: 18 },
      { k: 'retencionMensajesDias', etiqueta: 'Conservación de mensajes internos del equipo', unidad: 'días', min: 30, max: 3650 },
    ],
  },
];

const MODULOS: { id: ConfiguracionCentro['modulosActivos'][number]; nombre: string; icono: Icono; nota: string }[] = [
  { id: 'PAGINA_PUBLICA', nombre: 'Página pública del centro', icono: 'public', nota: 'Sitio con equipo, servicios y contacto' },
  { id: 'FICHAS', nombre: 'Fichas y Pacientes', icono: 'folder_shared', nota: 'Fichas clínicas con acceso restringido por profesional' },
  { id: 'AGENDA', nombre: 'Agenda y Espacios', icono: 'calendar_month', nota: 'Reservas por box y disponibilidad del equipo' },
  { id: 'EQUIPO', nombre: 'Equipo', icono: 'groups', nota: 'Perfiles, especialidades y roles del centro' },
  { id: 'MATCH', nombre: 'Match Terapéutico', icono: 'join', nota: 'Cuestionario público que recomienda profesionales' },
  { id: 'COBROS', nombre: 'Cobros', icono: 'payments', nota: 'Pagos, boletas y liquidaciones por profesional' },
];

const MODELOS: { valor: ConfiguracionCentro['modeloCobro']; texto: string }[] = [
  { valor: 'CENTRO', texto: 'Cobra el centro (boleta del centro)' },
  { valor: 'DIRECTO', texto: 'Cobra cada profesional (boleta del profesional)' },
  { valor: 'MIXTO', texto: 'Mixto (según quién registre el pago)' },
];

/**
 * Reglas y parametros del centro (pestañas de Configuracion que no son
 * identidad, horario ni politicas). Los porcentajes llegan como texto
 * (Decimal). Los modulos los activa el operador de Vinculos (panel maestro):
 * aca solo se ven.
 */
export function ReglasCentro({ seccion }: { seccion: 'reglas' | 'modulos' | 'roles' }) {
  const configuracion = useConfiguracionCentro();
  return (
    <EstadoConsulta consulta={configuracion}>
      {(c) => (seccion === 'modulos' ? <Modulos c={c} /> : seccion === 'roles' ? <Roles c={c} /> : <Parametros key={c.updatedAt} c={c} />)}
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

function Parametros({ c }: { c: ConfiguracionCentro }) {
  const [valores, setValores] = useState<Record<Numerico, string>>(
    () => Object.fromEntries(GRUPOS.flatMap((g) => g.campos).map((f) => [f.k, String(c[f.k])])) as Record<Numerico, string>,
  );
  const [modelo, setModelo] = useState(c.modeloCobro);
  const [exigeEvolucion, setExigeEvolucion] = useState(c.liquidarExigeEvolucion);
  const [guardado, setGuardado] = useState(false);
  const guardar = useGuardarConfiguracion(() => setGuardado(true));
  const enviar = () => {
    const campos = GRUPOS.flatMap((g) => g.campos);
    const malo = campos.find((f) => {
      const n = Number(valores[f.k]);
      return valores[f.k] === '' || Number.isNaN(n) || n < f.min || n > f.max;
    });
    if (malo) return guardar.setError(`${malo.etiqueta}: entre ${malo.min} y ${malo.max} ${malo.unidad}.`);
    guardar.mutate({
      ...(Object.fromEntries(campos.map((f) => [f.k, Number(valores[f.k])])) as Record<Numerico, number>),
      modeloCobro: modelo,
      liquidarExigeEvolucion: exigeEvolucion,
    });
  };
  return (
    <div className="flex flex-col gap-6">
      {GRUPOS.map((g) => (
        <Panel key={g.id} id={g.id} titulo={g.titulo} bajada={g.bajada}>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {g.campos.map((f) => (
              <Field key={f.k} label={f.etiqueta} hint={f.ayuda ?? `Entre ${f.min} y ${f.max} ${f.unidad}.`}>
                {(x) => (
                  <span className="flex items-center gap-2">
                    <Input
                      {...x}
                      inputMode="decimal"
                      value={valores[f.k]}
                      onChange={(e) => {
                        setGuardado(false);
                        setValores((v) => ({ ...v, [f.k]: e.target.value.replace(/[^\d.]/g, '') }));
                      }}
                      className="!w-[120px]"
                    />
                    <span className="text-[13px] font-bold text-neutral-700">{f.unidad}</span>
                  </span>
                )}
              </Field>
            ))}
            {g.id === 'cobros' && (
              <>
                <Field label="Quién cobra las sesiones">
                  {(x) => (
                    <Select {...x} value={modelo} onChange={(e) => setModelo(e.target.value as typeof modelo)}>
                      {MODELOS.map((m) => (
                        <option key={m.valor} value={m.valor}>
                          {m.texto}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="sm:col-span-2">
                  <Interruptor
                    tono="team"
                    etiqueta="Liquidar solo sesiones con evolución registrada"
                    descripcion="Una sesión realizada sin evolución no entra en la liquidación hasta que el profesional la cierre."
                    activo={exigeEvolucion}
                    onChange={(v) => {
                      setGuardado(false);
                      setExigeEvolucion(v);
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </Panel>
      ))}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-full border border-divider bg-bg/95 px-4 py-2.5 shadow-md">
        {guardar.error && (
          <p role="alert" className="m-0 mr-auto text-[13px] font-bold text-accent-700">
            {guardar.error}
          </p>
        )}
        {guardado && !guardar.error && (
          <p role="status" className="m-0 mr-auto text-[13px] font-bold text-accent-2-800">
            Cambios guardados.
          </p>
        )}
        <Button variant="team" icon="save" loading={guardar.isPending} onClick={enviar}>
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}

function Modulos({ c }: { c: ConfiguracionCentro }) {
  return (
    <Panel
      titulo="Módulos del centro"
      bajada="Los activa el equipo de Vínculos según lo contratado. Para sumar uno, escríbenos: la activación no es automática."
      accion={<Badge>{`${c.modulosActivos.length} de ${MODULOS.length} activos`}</Badge>}
    >
      <ul className="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2">
        {MODULOS.map((m) => {
          const activo = c.modulosActivos.includes(m.id);
          return (
            <li
              key={m.id}
              className={`flex items-start gap-3.5 rounded-[18px] border px-4 py-3.5 ${activo ? 'border-accent-2-500 bg-accent-2-200' : 'border-divider bg-neutral-100'}`}
            >
              <Icon name={m.icono} size={22} className={activo ? 'mt-0.5 text-accent-2-800' : 'mt-0.5 text-neutral-700'} />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[14.5px] font-extrabold">{m.nombre}</p>
                <p className="m-0 text-[12.5px] font-semibold text-neutral-800">{m.nota}</p>
              </div>
              <Badge tono={activo ? 'positivo' : 'neutro'}>{activo ? 'Activo' : 'No contratado'}</Badge>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Roles({ c }: { c: ConfiguracionCentro }) {
  const guardar = useGuardarConfiguracion();
  return (
    <div className="flex flex-col gap-6">
      <Panel
        titulo="Jerarquía de accesos"
        bajada="Acá se define la política general. El rol de cada persona se asigna en Equipo."
        accion={
          <Link href="/admin/equipo" className="flex items-center gap-1.5 text-[13px] font-extrabold text-accent-700">
            <Icon name="groups" size={17} />
            Ver personas en Equipo
          </Link>
        }
      >
        <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
          {[
            ['Cuenta madre (ADMIN)', 'Configuración, cobros, equipo y la vista administrativa de fichas. Nunca el contenido clínico.'],
            ['Gestión', 'Agenda, recepción y cobros del día a día, sin Configuración ni contenido clínico.'],
            ['Profesional', 'Sus pacientes, su agenda y sus fichas; otras fichas solo por derivación o acceso temporal.'],
            ['Practicante', 'Acceso con fecha de término, bajo supervisión y con consentimiento del paciente.'],
          ].map(([r, t]) => (
            <li key={r} className="flex items-start gap-3 rounded-[14px] border border-divider bg-bg px-4 py-3">
              <Icon name="admin_panel_settings" size={20} className="mt-0.5 flex-none text-neutral-700" />
              <div>
                <p className="m-0 text-[14px] font-extrabold">{r}</p>
                <p className="m-0 text-[12.5px] font-semibold text-neutral-800">{t}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel titulo="Rol de gestión" bajada="Para centros con recepción o coordinación administrativa.">
        <div className="mt-4">
          <Interruptor
            tono="team"
            etiqueta="Habilitar el rol de gestión"
            descripcion="Si se desactiva, el rol de gestión deja de estar disponible en el centro."
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
