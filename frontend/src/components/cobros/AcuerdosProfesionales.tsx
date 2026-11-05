'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Interruptor } from '@/components/ui/Interruptor';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { useConfiguracionCentro, useDirectorioEquipo, type ConfiguracionCentro } from '@/lib/centro';
import { formatoClp, formatoFecha } from '@/lib/formato';
import { fechaHoyChile } from '@/lib/panel';
import { retencionDelAnio } from '@/lib/tributario';

type Acuerdo = components['schemas']['AcuerdoProfesionalVista'];
type Modelo = Acuerdo['modelo'];
type Miembro = components['schemas']['MiembroDirectorio'];

/** A = cobra el profesional, B = cobra el centro, C = mixto (cuota, box y comisiones). */
export const LETRA: Record<Modelo, string> = { DIRECTO: 'A', CENTRO: 'B', MIXTO: 'C' };
const MODELOS: { valor: Modelo; texto: string }[] = [
  { valor: 'DIRECTO', texto: 'A · Cobra el profesional' },
  { valor: 'CENTRO', texto: 'B · Cobra el centro' },
  { valor: 'MIXTO', texto: 'C · Mixto' },
];
const CAPTADOS: { valor: Acuerdo['comisionDerivacionTipo']; texto: string }[] = [
  { valor: 'GENERAL', texto: 'La misma comisión general' },
  { valor: 'PORCENTAJE', texto: 'Un porcentaje distinto' },
  { valor: 'MONTO_FIJO', texto: 'Un monto fijo por sesión' },
];

interface Borrador {
  modelo: Modelo;
  cobra: Acuerdo['cobra'];
  comisionPorcentaje: string;
  comisionDerivacionTipo: Acuerdo['comisionDerivacionTipo'];
  comisionDerivacionValor: string;
  cuotaMensual: string;
  cargoBoxHora: string;
  ivaBox: boolean;
  vigenteDesde: string;
}

/** Primer dia del mes siguiente (por defecto un cambio rige desde ahi). */
function proximoMes(hoy: string): string {
  const [a, m] = hoy.split('-').map(Number) as [number, number];
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
}

const borradorDe = (a: Acuerdo | undefined, c: ConfiguracionCentro, hoy: string): Borrador =>
  a
    ? {
        modelo: a.modelo,
        cobra: a.cobra,
        comisionPorcentaje: String(Number(a.comisionPorcentaje)),
        comisionDerivacionTipo: a.comisionDerivacionTipo,
        comisionDerivacionValor: String(Number(a.comisionDerivacionValor)),
        cuotaMensual: String(a.cuotaMensual),
        cargoBoxHora: String(a.cargoBoxHora),
        ivaBox: a.ivaBox,
        vigenteDesde: proximoMes(hoy),
      }
    : {
        modelo: c.modeloCobro,
        cobra: c.modeloCobro === 'DIRECTO' ? 'PROFESIONAL' : 'CENTRO',
        comisionPorcentaje: String(Number(c.comisionCentroPorcentaje)),
        comisionDerivacionTipo: c.comisionDerivacionTipo,
        comisionDerivacionValor: String(Number(c.comisionDerivacionValor)),
        cuotaMensual: '0',
        cargoBoxHora: '0',
        ivaBox: false,
        vigenteDesde: hoy,
      };

/** Resumen de "Cargos del centro" de una fila. */
export function cargos(a: Pick<Acuerdo, 'comisionPorcentaje' | 'comisionDerivacionTipo' | 'comisionDerivacionValor' | 'cuotaMensual' | 'cargoBoxHora' | 'cobra'>) {
  const partes: string[] = [];
  if (a.cuotaMensual > 0) partes.push(`Cuota ${formatoClp(a.cuotaMensual)}`);
  if (a.cargoBoxHora > 0) partes.push(`Box ${formatoClp(a.cargoBoxHora)} por hora`);
  if (a.cobra === 'CENTRO' && Number(a.comisionPorcentaje) > 0) partes.push(`${Number(a.comisionPorcentaje)}% de lo cobrado`);
  if (a.comisionDerivacionTipo === 'PORCENTAJE') partes.push(`${Number(a.comisionDerivacionValor)}% de pacientes captados`);
  if (a.comisionDerivacionTipo === 'MONTO_FIJO') partes.push(`${formatoClp(Number(a.comisionDerivacionValor))} por sesión captada`);
  return partes.join(' · ') || 'Sin cargos';
}

/**
 * Ejemplo de un mes (diseño): 20 sesiones de $35.000, 8 de pacientes que
 * llegaron por el centro, 20 horas de box. Misma regla que generar_liquidacion
 * (comision, captados, cuota, box); la retencion de la boleta es informativa.
 */
function ejemplo(b: Borrador, anio: number): { l: string; v: string; total?: boolean }[] {
  const sesiones = 20;
  const valor = 35000;
  const captadas = 8;
  const bruto = sesiones * valor;
  const pct = Number(b.comisionPorcentaje) || 0;
  const der = Number(b.comisionDerivacionValor) || 0;
  const porCaptada =
    b.comisionDerivacionTipo === 'PORCENTAJE' ? (valor * der) / 100 : b.comisionDerivacionTipo === 'MONTO_FIJO' ? Math.min(der, valor) : (valor * pct) / 100;
  const comisionCaptados = Math.round(captadas * porCaptada);
  const cuota = Number(b.cuotaMensual) || 0;
  const box = Math.round(20 * (Number(b.cargoBoxHora) || 0));
  if (b.cobra === 'PROFESIONAL') {
    const captadosPropios = b.comisionDerivacionTipo === 'GENERAL' ? 0 : comisionCaptados;
    const paga = box + cuota + captadosPropios;
    return [
      { l: 'Cobra el profesional', v: formatoClp(bruto) },
      ...(box ? [{ l: 'Uso de box: 20 h', v: formatoClp(box) }] : []),
      ...(cuota ? [{ l: 'Cuota fija', v: formatoClp(cuota) }] : []),
      ...(captadosPropios ? [{ l: `Comisión de ${captadas} captadas`, v: formatoClp(captadosPropios) }] : []),
      { l: 'Paga al centro', v: `${formatoClp(paga)}${b.ivaBox && box ? ' + IVA del box' : ''}`, total: true },
    ];
  }
  const centro = Math.round(((sesiones - captadas) * valor * pct) / 100) + comisionCaptados + cuota + box;
  const boleta = bruto - centro;
  const retencion = Math.round((boleta * retencionDelAnio(anio)) / 100);
  return [
    { l: 'Bruto cobrado por el centro', v: formatoClp(bruto) },
    { l: 'Para el centro', v: formatoClp(centro) },
    { l: 'Boleta del profesional', v: formatoClp(boleta) },
    { l: `Retención ${String(retencionDelAnio(anio)).replace('.', ',')}%`, v: formatoClp(retencion) },
    { l: 'Recibe el profesional', v: formatoClp(boleta - retencion), total: true },
  ];
}

/**
 * Acuerdos por profesional (Configuracion > Cobros, diseño "Opcion A submenu
 * agrupado"): una fila por profesional con su acuerdo vigente (o el del
 * centro) y el detalle editable con un ejemplo de un mes. Cada cambio es una
 * version nueva que rige desde su fecha; lo ya liquidado no cambia (la BD lo
 * impide). Escribe solo la cuenta madre.
 */
export function AcuerdosProfesionales() {
  const configuracion = useConfiguracionCentro();
  const equipo = useDirectorioEquipo(true);
  const acuerdos = useQuery({ queryKey: ['cobros', 'acuerdos'], queryFn: () => datos(api.GET('/api/cobros/acuerdos')) });
  const [elegido, setElegido] = useState<string | null>(null);
  const hoy = fechaHoyChile();
  return (
    <Panel titulo="Acuerdos por profesional" bajada="Un cambio rige desde su fecha. Lo ya liquidado no cambia." nivel={3}>
      <EstadoConsulta consulta={acuerdos}>
        {(lista) => (
          <EstadoConsulta consulta={configuracion}>
            {(c) => {
              const miembros = (equipo.data ?? []).filter((m) => m.roles.includes('PROFESIONAL') || m.roles.includes('PRACTICANTE'));
              const vigente = (id: string) =>
                lista.filter((a) => a.profesionalId === id && a.vigenteDesde.slice(0, 10) <= hoy).sort((x, y) => (x.vigenteDesde < y.vigenteDesde ? 1 : -1))[0];
              const programado = (id: string) =>
                lista.filter((a) => a.profesionalId === id && a.vigenteDesde.slice(0, 10) > hoy).sort((x, y) => (x.vigenteDesde > y.vigenteDesde ? 1 : -1))[0];
              const actual = miembros.find((m) => m.id === elegido) ?? miembros.find((m) => m.roles.includes('PROFESIONAL'));
              return (
                <div className="flex flex-col gap-3">
                  <div className="overflow-x-auto">
                    <div className="flex min-w-[720px] flex-col gap-1">
                      <div className="grid grid-cols-[1.6fr_1.4fr_1.8fr_1fr_0.7fr] gap-2.5 px-3 text-[12px] font-extrabold text-neutral-700">
                        <span>Profesional</span>
                        <span>Quién cobra</span>
                        <span>Cargos del centro</span>
                        <span>Vigente desde</span>
                        <span />
                      </div>
                      {miembros.map((m) => (
                        <Fila key={m.id} m={m} a={vigente(m.id)} proximo={programado(m.id)} elegido={actual?.id === m.id} onElegir={() => setElegido(m.id)} />
                      ))}
                      {miembros.length === 0 && <p className="m-0 px-3 py-2 text-[13px] font-semibold text-neutral-700">Sin profesionales en el equipo.</p>}
                    </div>
                  </div>
                  {actual && actual.roles.includes('PROFESIONAL') && (
                    <Detalle key={`${actual.id}-${lista.length}`} m={actual} a={vigente(actual.id)} proximo={programado(actual.id)} c={c} hoy={hoy} />
                  )}
                </div>
              );
            }}
          </EstadoConsulta>
        )}
      </EstadoConsulta>
    </Panel>
  );
}

function Fila({ m, a, proximo, elegido, onElegir }: { m: Miembro; a?: Acuerdo; proximo?: Acuerdo; elegido: boolean; onElegir: () => void }) {
  const practicante = !m.roles.includes('PROFESIONAL');
  const nombre = m.nombre ?? 'Integrante';
  const clase = `grid min-h-[52px] grid-cols-[1.6fr_1.4fr_1.8fr_1fr_0.7fr] items-center gap-2.5 rounded-[12px] px-3 py-1.5 text-left text-[14px] ${
    elegido ? 'border-2 border-accent-700 bg-accent-100' : 'border border-divider bg-bg'
  }`;
  if (practicante)
    return (
      <div className={clase}>
        <span className="font-extrabold">{nombre}</span>
        <span className="flex items-center gap-1.5">
          <Chip>-</Chip>No cobra
        </span>
        <span className="text-[13px] font-semibold text-neutral-800">En práctica supervisada, sin cargos</span>
        <span className="text-[13px] font-semibold text-neutral-700">No se liquida</span>
        <span />
      </div>
    );
  return (
    <button type="button" aria-pressed={elegido} onClick={onElegir} className={`${clase} cursor-pointer hover:border-accent-500`}>
      <span className="font-extrabold">{nombre}</span>
      <span className="flex items-center gap-1.5">
        {a ? (
          <>
            <Chip oscuro>{LETRA[a.modelo]}</Chip>
            {a.cobra === 'CENTRO' ? 'Cobra el centro' : 'Cobra el profesional'}
          </>
        ) : (
          <>
            <Chip aviso>?</Chip>Sin acuerdo propio
          </>
        )}
      </span>
      <span className="text-[13px] font-semibold text-neutral-800">
        {a ? cargos(a) : 'Usa el acuerdo del centro'}
        {proximo && <span className="block text-[12px] text-accent-700">Cambia el {formatoFecha(proximo.vigenteDesde)}</span>}
      </span>
      <span className="text-[13px] font-semibold text-neutral-800">{a ? formatoFecha(a.vigenteDesde) : '-'}</span>
      <span className="text-[13px] font-extrabold text-accent-700">{a ? 'Editar' : 'Definir'}</span>
    </button>
  );
}

function Chip({ children, oscuro, aviso }: { children: string; oscuro?: boolean; aviso?: boolean }) {
  const tono = oscuro ? 'bg-text text-neutral-100' : aviso ? 'bg-pendiente-100 text-pendiente-900' : 'bg-neutral-200 text-neutral-800';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${tono}`}>{children}</span>;
}

function Detalle({ m, a, proximo, c, hoy }: { m: Miembro; a?: Acuerdo; proximo?: Acuerdo; c: ConfiguracionCentro; hoy: string }) {
  const cliente = useQueryClient();
  const [b, setB] = useState<Borrador>(() => {
    const base = borradorDe(proximo ?? a, c, hoy);
    // Una version nueva no puede repetir la fecha del cambio ya programado.
    return proximo ? { ...base, vigenteDesde: proximoMes(proximo.vigenteDesde.slice(0, 10)) } : base;
  });
  const [estado, setEstado] = useState<{ error?: string; ok?: string }>({});
  const poner = <K extends keyof Borrador>(k: K, v: Borrador[K]) => {
    setEstado({});
    setB((x) => {
      const n = { ...x, [k]: v };
      // A siempre lo cobra el profesional; B el centro.
      if (k === 'modelo') n.cobra = v === 'DIRECTO' ? 'PROFESIONAL' : v === 'CENTRO' ? 'CENTRO' : x.cobra;
      return n;
    });
  };
  const numero =
    (k: 'comisionPorcentaje' | 'comisionDerivacionValor' | 'cuotaMensual' | 'cargoBoxHora', decimales: boolean) => (e: { target: { value: string } }) =>
      poner(k, e.target.value.replace(decimales ? /[^\d.]/g : /\D/g, ''));
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/cobros/acuerdos', {
          body: {
            profesionalId: m.id,
            modelo: b.modelo,
            cobra: b.cobra,
            comisionPorcentaje: Number(b.comisionPorcentaje) || 0,
            comisionDerivacionTipo: b.comisionDerivacionTipo,
            comisionDerivacionValor: b.comisionDerivacionTipo === 'GENERAL' ? 0 : Number(b.comisionDerivacionValor) || 0,
            cuotaMensual: Number(b.cuotaMensual) || 0,
            cargoBoxHora: Number(b.cargoBoxHora) || 0,
            ivaBox: b.ivaBox,
            vigenteDesde: b.vigenteDesde,
          },
        }),
      ),
    onSuccess: () => {
      setEstado({ ok: `Acuerdo guardado: rige desde el ${formatoFecha(b.vigenteDesde)}.` });
      void cliente.invalidateQueries({ queryKey: ['cobros', 'acuerdos'] });
    },
    onError: (e) => setEstado({ error: e instanceof ApiError ? e.message : 'No pudimos guardar el acuerdo.' }),
  });
  const enviar = () => {
    if (!b.vigenteDesde) return setEstado({ error: 'Elige desde cuándo rige.' });
    if (Number(b.comisionPorcentaje) > 100) return setEstado({ error: 'La comisión va de 0 a 100 %.' });
    if (b.comisionDerivacionTipo === 'PORCENTAJE' && Number(b.comisionDerivacionValor) > 100)
      return setEstado({ error: 'La comisión de pacientes captados va de 0 a 100 %.' });
    guardar.mutate();
  };
  const filas = ejemplo(b, Number(b.vigenteDesde.slice(0, 4)) || Number(hoy.slice(0, 4)));
  const cobraCentro = b.cobra === 'CENTRO';
  return (
    <div className="flex flex-col gap-4 rounded-[16px] border border-divider bg-bg p-4 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <span className="text-[16px] font-black">Acuerdo de {m.nombre ?? 'el profesional'}</span>
        {proximo && (
          <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
            Ya hay un cambio programado para el {formatoFecha(proximo.vigenteDesde)} (parte de esos valores). Las versiones no se editan: la nueva rige desde
            otra fecha.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Modelo">
            {(x) => (
              <Select {...x} value={b.modelo} onChange={(e) => poner('modelo', e.target.value as Modelo)}>
                {MODELOS.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.texto}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Quién cobra al paciente" hint={b.modelo === 'MIXTO' ? undefined : 'Lo fija el modelo.'}>
            {(x) => (
              <Select {...x} value={b.cobra} disabled={b.modelo !== 'MIXTO'} onChange={(e) => poner('cobra', e.target.value as Acuerdo['cobra'])}>
                <option value="CENTRO">El centro</option>
                <option value="PROFESIONAL">El profesional</option>
              </Select>
            )}
          </Field>
          {cobraCentro && (
            <Field label="Comisión sobre todas las atenciones" hint="Sobre lo que cobra el centro.">
              {(x) => (
                <span className="flex items-center gap-2">
                  <Input {...x} inputMode="decimal" value={b.comisionPorcentaje} onChange={numero('comisionPorcentaje', true)} className="!w-[110px] !py-2.5" />
                  <span className="text-[13px] font-bold text-neutral-700">%</span>
                </span>
              )}
            </Field>
          )}
          <Field
            label="Pacientes que llegaron por el centro"
            hint={cobraCentro ? 'Reemplaza la comisión general en esas sesiones.' : 'Lo que el profesional le paga al centro por cada una.'}
          >
            {(x) => (
              <Select
                {...x}
                value={b.comisionDerivacionTipo}
                onChange={(e) => poner('comisionDerivacionTipo', e.target.value as Acuerdo['comisionDerivacionTipo'])}
              >
                {CAPTADOS.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.texto}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {b.comisionDerivacionTipo !== 'GENERAL' && (
            <Field label={b.comisionDerivacionTipo === 'PORCENTAJE' ? 'Porcentaje por sesión captada' : 'Monto por sesión captada'}>
              {(x) => (
                <span className="flex items-center gap-2">
                  {b.comisionDerivacionTipo === 'MONTO_FIJO' && <span className="text-[13px] font-bold text-neutral-700">$</span>}
                  <Input
                    {...x}
                    inputMode="decimal"
                    value={b.comisionDerivacionValor}
                    onChange={numero('comisionDerivacionValor', b.comisionDerivacionTipo === 'PORCENTAJE')}
                    className="!w-[120px] !py-2.5"
                  />
                  {b.comisionDerivacionTipo === 'PORCENTAJE' && <span className="text-[13px] font-bold text-neutral-700">%</span>}
                </span>
              )}
            </Field>
          )}
          <Field label="Cuota fija mensual" hint="Una por cada mes que empieza dentro del período liquidado.">
            {(x) => (
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-neutral-700">$</span>
                <Input {...x} inputMode="numeric" value={b.cuotaMensual} onChange={numero('cuotaMensual', false)} className="!w-[140px] !py-2.5" />
              </span>
            )}
          </Field>
          <Field label="Cargo por uso de box" hint="Por cada hora de box apartada en el período.">
            {(x) => (
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-neutral-700">$</span>
                <Input {...x} inputMode="numeric" value={b.cargoBoxHora} onChange={numero('cargoBoxHora', false)} className="!w-[140px] !py-2.5" />
                <span className="text-[13px] font-bold text-neutral-700">por hora</span>
              </span>
            )}
          </Field>
          <Field label="Vigente desde" hint="Lo ya liquidado no cambia.">
            {(x) => <Input {...x} type="date" value={b.vigenteDesde} onChange={(e) => poner('vigenteDesde', e.target.value)} className="!py-2.5" />}
          </Field>
          {Number(b.cargoBoxHora) > 0 && (
            <div className="sm:col-span-2">
              <Interruptor
                tono="team"
                etiqueta="Box amoblado: el arriendo lleva IVA"
                descripcion="Lo factura el centro en su sistema; acá solo se informa."
                activo={b.ivaBox}
                onChange={(v) => poner('ivaBox', v)}
              />
            </div>
          )}
        </div>
        {estado.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {estado.error}
          </p>
        )}
        {estado.ok && (
          <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
            {estado.ok}
          </p>
        )}
        <div>
          <Button variant="team" icon="save" loading={guardar.isPending} onClick={enviar}>
            Guardar acuerdo
          </Button>
        </div>
      </div>
      <aside aria-label="Ejemplo de un mes" className="flex flex-col gap-2 rounded-[14px] bg-surface p-3.5 lg:w-[300px] lg:flex-none">
        <span className="text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Ejemplo de un mes</span>
        <span className="text-[12px] font-semibold text-neutral-800">20 sesiones de $35.000, 8 de pacientes que llegaron por el centro, 20 h de box.</span>
        {filas.map((f) => (
          <div key={f.l} className={`flex justify-between gap-2 text-[13px] ${f.total ? 'border-t border-neutral-400 pt-2 font-black' : 'font-semibold'}`}>
            <span>{f.l}</span>
            <span className="tabular-nums">{f.v}</span>
          </div>
        ))}
        <span className="text-[11px] font-semibold text-neutral-700">Cálculo informativo, no tributario.</span>
      </aside>
    </div>
  );
}
