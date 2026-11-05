'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import { useMiCuenta } from '@/lib/consultas';
import { useDerivacionesLista } from '@/lib/derivaciones';
import { plazoEvolucion, sinEvolucionPorPaciente, useBorradores, usePendientesFichas, type PendienteFicha } from '@/lib/fichas';
import { formatoFechaCorta, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { fechaHoyChile, hoyChile, nombresPacientes, useCitas, useEquipoAgenda, useEspacios, useEstadoFichas, usePacientes } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { NuevoPaciente } from './NuevoPaciente';

type VistaRiel = 'hoy' | 'pendientes' | 'todos';

const CLAVE_VISTA = 'vinculos_riel_pacientes';
const vistaGuardada = (): VistaRiel => {
  try {
    const v = sessionStorage.getItem(CLAVE_VISTA);
    return v === 'hoy' || v === 'todos' ? v : 'pendientes';
  } catch {
    return 'pendientes';
  }
};

/** Un paciente en "Por hacer": a que grupo va y que se le muestra debajo del nombre. */
export interface PorHacer {
  pacienteId: string;
  grupo: 'evolucion' | 'borrador' | 'consentimiento' | 'datos' | 'derivacion';
  detalle: string;
}

const GRUPOS: { g: PorHacer['grupo']; titulo: string; color: string }[] = [
  { g: 'evolucion', titulo: 'Evoluciones por registrar', color: 'text-accent-800' },
  { g: 'borrador', titulo: 'Borradores sin confirmar', color: 'text-accent-800' },
  { g: 'consentimiento', titulo: 'Consentimientos', color: 'text-pendiente-900' },
  { g: 'datos', titulo: 'Datos faltantes', color: 'text-pendiente-900' },
  { g: 'derivacion', titulo: 'Derivaciones', color: 'text-text' },
];

const esHoy = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }) === fechaHoyChile();

/**
 * "Por hacer" del profesional a partir de los pendientes de sus fichas
 * (pendientes_fichas), sus borradores y sus derivaciones enviadas en curso.
 * Pura, para probarla sin la API.
 */
export function porHacer(
  pendientes: readonly PendienteFicha[],
  borradores: readonly { pacienteId?: string | null; actualizadoEn: string }[],
  derivaciones: readonly { pacienteId: string | null; estado: string; candidatos: { estado: string; profesionalId: string; venceEn: string | null }[] }[],
  nombre: (id: string) => string,
): PorHacer[] {
  const items: PorHacer[] = [];
  for (const g of sinEvolucionPorPaciente(pendientes)) {
    const primera = g.sesiones[0]!;
    const fechas = g.sesiones.map((s) => (esHoy(s.fecha!) ? `Hoy ${formatoHora(s.fecha!)}` : formatoFechaCorta(s.fecha!)));
    const texto = fechas.length > 1 ? `${fechas.slice(0, -1).join(', ')} y ${fechas.at(-1)}` : fechas[0]!;
    items.push({
      pacienteId: g.pacienteId,
      grupo: 'evolucion',
      detalle: esHoy(primera.fecha!) && fechas.length === 1 ? texto : `${texto} · ${plazoEvolucion(primera.vence!).texto.toLowerCase()}`,
    });
  }
  for (const b of borradores) {
    if (b.pacienteId) items.push({ pacienteId: b.pacienteId, grupo: 'borrador', detalle: `Guardado el ${formatoFechaCorta(b.actualizadoEn)}` });
  }
  for (const p of pendientes) {
    const sesion = p.fecha ? `sesión el ${formatoFechaCorta(p.fecha)}` : 'sin hora';
    if (p.tipo === 'CONSENTIMIENTO')
      items.push({
        pacienteId: p.paciente_id,
        grupo: 'consentimiento',
        detalle: `Informado sin aceptar${p.menor ? ' · lo da su adulto responsable' : ''} · ${sesion}`,
      });
    if (p.tipo === 'SIN_RUT') items.push({ pacienteId: p.paciente_id, grupo: 'datos', detalle: `Sin RUT · ${sesion}` });
    if (p.tipo === 'SIN_RESPONSABLE') items.push({ pacienteId: p.paciente_id, grupo: 'datos', detalle: `Menor sin adulto responsable · ${sesion}` });
  }
  for (const d of derivaciones) {
    if (!d.pacienteId || !['PENDIENTE', 'ESPERANDO_CONSENTIMIENTO', 'SIN_ASIGNAR'].includes(d.estado)) continue;
    const ofrecida = d.candidatos.find((c) => c.estado === 'OFRECIDA');
    items.push({
      pacienteId: d.pacienteId,
      grupo: 'derivacion',
      detalle: ofrecida
        ? `Enviada a ${nombre(ofrecida.profesionalId)} · ${Math.max(0, Math.round((new Date(ofrecida.venceEn ?? Date.now()).getTime() - Date.now()) / 3_600_000))} h`
        : 'Enviada · sin candidato asignado',
    });
  }
  return items;
}

/**
 * Riel "Mis pacientes" (diseño "Profesional flujo del dia y ficha
 * completa"): tres vistas para llegar a la ficha. Hoy (sesiones del dia con
 * su estado), Por hacer (lo pendiente agrupado) y Todos (buscador con un
 * punto de estado). Solo nombres y metadata: el contenido clinico vive en la
 * ficha de la derecha.
 */
export function RielPacientes({ rol, seleccionado }: { rol: Rol; seleccionado?: string }) {
  const router = useRouter();
  const cuenta = useMiCuenta();
  const yo = cuenta.data?.id;
  const pacientes = usePacientes();
  const pendientes = usePendientesFichas(undefined, !!yo);
  const borradores = useBorradores();
  const derivaciones = useDerivacionesLista(undefined, rol === 'PROFESIONAL');
  const estados = useEstadoFichas(yo);
  const [rango] = useState(hoyChile);
  const citas = useCitas({ ...rango, profesionalId: yo }, !!yo);
  const conEvolucion = useQuery({
    queryKey: ['panel', 'citas-con-evolucion', rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/citas-con-evolucion', { params: { query: rango } })),
  });
  const espacios = useEspacios();
  const equipo = useEquipoAgenda();
  // La vista del riel sobrevive al abrir y cerrar fichas (cada ficha es otra pagina). Solo el nombre de la vista.
  const [vista, setVistaEstado] = useState<VistaRiel>(vistaGuardada);
  const setVista = (v: VistaRiel) => {
    setVistaEstado(v);
    try {
      sessionStorage.setItem(CLAVE_VISTA, v);
    } catch {
      // Sin almacenamiento (modo privado): la vista vuelve a "Por hacer".
    }
  };
  const [busqueda, setBusqueda] = useState('');
  const texto = useDeferredValue(busqueda.trim().toLowerCase());

  const nombres = nombresPacientes(pacientes.data);
  const nombre = (id: string) => nombres.get(id) ?? 'Paciente';
  const box = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const lista = porHacer(
    pendientes.data ?? [],
    borradores.data ?? [],
    (derivaciones.data ?? []).filter((d) => d.profesionalOrigenId === yo),
    (id) => equipo.data?.find((m) => m.id === id)?.nombre ?? 'otro profesional',
  );
  const hoy = (citas.data ?? [])
    .filter((c) => c.pacienteId && (c.estado === 'CONFIRMADA' || c.estado === 'PENDIENTE_PAGO'))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  const cerradas = new Set(conEvolucion.data ?? []);
  const ahora = Date.now();
  const estadoPaciente = new Map<string, 'sc' | 'falta' | 'ok'>();
  for (const i of lista) {
    if (i.grupo === 'evolucion' || i.grupo === 'borrador') estadoPaciente.set(i.pacienteId, 'sc');
    else if (!estadoPaciente.has(i.pacienteId) && i.grupo !== 'derivacion') estadoPaciente.set(i.pacienteId, 'falta');
  }
  const proxima = new Map((estados.data ?? []).map((e) => [e.paciente_id, e]));

  // Tocar al paciente ya abierto cierra su ficha (vuelve a "ningun paciente seleccionado").
  const ir = (id: string) => router.push(id === seleccionado ? '/admin/fichas' : `/admin/fichas/${id}`, { scroll: false });
  const marca = (id: string) => (id === seleccionado ? 'border-2 border-text bg-bg' : 'border border-transparent hover:border-divider hover:bg-bg');

  const vistas: { valor: VistaRiel; etiqueta: string }[] = [
    { valor: 'hoy', etiqueta: 'Hoy' },
    { valor: 'pendientes', etiqueta: `Por hacer ${lista.length || ''}`.trim() },
    { valor: 'todos', etiqueta: 'Todos' },
  ];

  return (
    <section
      aria-labelledby="t-riel"
      className="flex w-full flex-col gap-2.5 rounded-md border border-divider bg-neutral-200 px-2.5 py-3.5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:max-w-[290px] lg:flex-[1_1_260px] lg:overflow-y-auto"
    >
      <div className="flex items-center gap-2 px-1.5">
        <h2 id="t-riel" className="m-0 text-[20px] font-black tracking-[-0.02em]">
          Mis pacientes
        </h2>
        <span className="ml-auto flex gap-1.5">{rol === 'PROFESIONAL' && <NuevoPaciente rol={rol} compacto />}</span>
      </div>
      <div role="tablist" aria-label="Vista" className="flex gap-1 rounded-sm bg-neutral-300 p-1">
        {vistas.map((v) => (
          <button
            key={v.valor}
            type="button"
            role="tab"
            aria-selected={vista === v.valor}
            onClick={() => setVista(v.valor)}
            className={`min-h-[38px] flex-1 cursor-pointer rounded-[9px] text-[13px] font-extrabold transition-colors duration-200 ${
              vista === v.valor ? 'bg-text text-neutral-100' : 'text-text hover:bg-neutral-100'
            }`}
          >
            {v.etiqueta}
          </button>
        ))}
      </div>

      {vista === 'hoy' && (
        <EstadoConsulta consulta={citas} vacio={() => hoy.length === 0} textoVacio="Sin sesiones hoy">
          {() => (
            <>
              <p className="m-0 px-1.5 text-[12px] font-semibold text-neutral-700 first-letter:uppercase">
                {formatoFechaLarga(new Date())} · {hoy.length === 1 ? '1 sesión' : `${hoy.length} sesiones`}
              </p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {hoy.map((c) => {
                  const fin = new Date(c.fin).getTime();
                  const estado =
                    c.estado === 'PENDIENTE_PAGO'
                      ? { t: 'Pago pendiente', c: 'bg-pendiente-100 text-pendiente-900' }
                      : fin <= ahora && !cerradas.has(c.id)
                        ? { t: 'Sin evolución', c: 'bg-accent-200 text-accent-900' }
                        : new Date(c.inicio).getTime() <= ahora && ahora < fin
                          ? { t: 'En curso', c: 'bg-online-100 text-online-900' }
                          : null;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-pressed={c.pacienteId === seleccionado}
                        onClick={() => ir(c.pacienteId!)}
                        className={`flex w-full cursor-pointer items-stretch gap-2.5 rounded-sm px-2 py-1.5 text-left ${marca(c.pacienteId!)}`}
                      >
                        <span className="w-[42px] flex-none pt-0.5 text-[13px] font-extrabold">{formatoHora(c.inicio)}</span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <strong className="truncate text-[13px]">{nombre(c.pacienteId!)}</strong>
                          <span className="text-[11.5px] font-semibold text-neutral-800">
                            {c.modalidad === 'ONLINE' ? 'Online · videollamada' : `Presencial${c.espacioId ? ` · ${box.get(c.espacioId) ?? 'box'}` : ''}`}
                          </span>
                          {estado && (
                            <span className={`self-start rounded-full px-2 py-px text-[10.5px] font-black tracking-[0.04em] uppercase ${estado.c}`}>
                              {estado.t}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </EstadoConsulta>
      )}

      {vista === 'pendientes' && (
        <EstadoConsulta consulta={pendientes} vacio={() => lista.length === 0} textoVacio="Nada pendiente: fichas al día">
          {() => (
            <div className="flex flex-col gap-2">
              {GRUPOS.map((g) => {
                const del = lista.filter((i) => i.grupo === g.g);
                if (!del.length) return null;
                return (
                  <div key={g.g} className="flex flex-col gap-1">
                    <p className={`m-0 px-1.5 pt-1 text-[11px] font-extrabold tracking-[0.1em] uppercase ${g.color}`}>
                      {g.titulo} · {del.length}
                    </p>
                    {del.map((i, n) => (
                      <button
                        key={`${i.pacienteId}-${n}`}
                        type="button"
                        aria-pressed={i.pacienteId === seleccionado}
                        onClick={() => ir(i.pacienteId)}
                        className={`flex min-h-12 w-full cursor-pointer flex-col gap-0.5 rounded-sm px-2.5 py-1.5 text-left ${
                          i.pacienteId === seleccionado ? 'border-2 border-text bg-bg' : 'border border-transparent bg-neutral-100 hover:border-divider'
                        }`}
                      >
                        <strong className="text-[13px]">{nombre(i.pacienteId)}</strong>
                        <span className="text-[11.5px] font-semibold text-neutral-800">{i.detalle}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </EstadoConsulta>
      )}

      {vista === 'todos' && (
        <>
          <div className="relative">
            <Icon name="search" size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-neutral-700" />
            <Input
              type="search"
              aria-label="Buscar paciente"
              placeholder={`Buscar entre ${(pacientes.data ?? []).length} pacientes`}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="!py-2 !pl-10 !text-[13px]"
            />
          </div>
          <EstadoConsulta consulta={pacientes} vacio={(l) => l.length === 0} textoVacio="Todavía no tienes pacientes">
            {(todos) => {
              const filtrados = todos
                .filter((p) => !texto || `${p.nombre} ${p.apellido}`.toLowerCase().includes(texto))
                .sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`));
              if (!filtrados.length) return <p className="m-0 px-1.5 text-[13px] font-semibold text-neutral-700">Ningún paciente coincide.</p>;
              return (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {filtrados.map((p) => {
                    const e = proxima.get(p.id);
                    const est = estadoPaciente.get(p.id) ?? 'ok';
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          aria-pressed={p.id === seleccionado}
                          onClick={() => ir(p.id)}
                          className={`flex min-h-[46px] w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1 text-left ${marca(p.id)}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`size-2.5 flex-none rounded-full ${est === 'sc' ? 'bg-accent-600' : est === 'falta' ? 'bg-pendiente-700' : 'bg-accent-2-600'}`}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <strong className="truncate text-[13px]">
                              {p.nombre} {p.apellido}
                            </strong>
                            <span className="text-[11.5px] font-semibold text-neutral-800">
                              {est === 'sc' ? 'Sesión por cerrar · ' : est === 'falta' ? 'Falta un dato · ' : ''}
                              {e?.alta_en ? 'Alta' : e?.proxima_sesion ? `Próxima ${formatoFechaCorta(e.proxima_sesion)}` : 'Sin hora agendada'}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              );
            }}
          </EstadoConsulta>
        </>
      )}
    </section>
  );
}
