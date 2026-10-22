'use client';

import { useState } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { dia } from '@/lib/horarios';
import { mesChile, nombreDeCita, nombresPacientes, semanaChile, useCitas, useEquipoAgenda, useEspacios, usePacientes, type CitaVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { SelectorPeriodo, type VistaAgenda } from './SelectorPeriodo';
import { NOMBRE_ESTADO_CITA, TONOS, tonoDe } from './tonosAgenda';

/** Preferencia sin datos sensibles: la ultima vista elegida (semana o mes). */
const CLAVE_VISTA = 'vinculos_vista_agenda';
const vistaGuardada = (): VistaAgenda => {
  try {
    return localStorage.getItem(CLAVE_VISTA) === 'mes' ? 'mes' : 'semana';
  } catch {
    return 'semana';
  }
};
const mesTitulo = new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MAX_EN_DIA = 3;

const diaCorto = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', weekday: 'long', day: 'numeric' });
const mesLargo = new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const horaLocal = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hourCycle: 'h23' });
const hora = (iso: string) => Number(horaLocal.format(new Date(iso)));

const ESTILO_ESTADO: Record<CitaVista['estado'], string> = {
  CONFIRMADA: 'border-divider bg-neutral-100',
  SOLICITADA: 'border-accent-500 bg-accent-200',
  POR_REPROGRAMAR: 'border-neutral-500 bg-neutral-200',
  CANCELADA: 'border-divider bg-neutral-100',
  PENDIENTE_PAGO: 'border-accent-500 bg-accent-200',
  LIBERADA: 'border-divider bg-neutral-100',
  RETENIDA: 'border-dashed border-accent-500 bg-accent-100',
};
const TEXTO_ESTADO: Record<CitaVista['estado'], string> = {
  CONFIRMADA: 'text-neutral-700',
  SOLICITADA: 'text-accent-800',
  POR_REPROGRAMAR: 'text-neutral-800',
  CANCELADA: 'text-neutral-700',
  PENDIENTE_PAGO: 'text-accent-800',
  LIBERADA: 'text-neutral-700',
  RETENIDA: 'text-accent-800',
};

/**
 * Calendario consolidado (diseño "Agenda y Espacios"): semana de lunes a
 * viernes (sabado si hay citas), una fila por hora y las sesiones coloreadas
 * por profesional o por box. ADMIN/GESTION ven todas las agendas (o la del
 * profesional elegido en el selector de equipo); el profesional, la suya.
 * Sin polling (estandar_polling.md): se recarga al volver a la pestaña o tras
 * una accion propia. Las retenciones ajenas ("Reservando...") no se muestran:
 * la API solo expone las propias.
 */
export function CalendarioAgenda({ rol, onElegir }: { rol: Rol; onElegir: (c: CitaVista) => void }) {
  const admin = esAdministracion(rol);
  const [vista, setVistaEstado] = useState<VistaAgenda>(vistaGuardada);
  const [semana, setSemana] = useState(0);
  const [modo, setModo] = useState<'profesional' | 'box'>('profesional');
  const { profesionalId } = useEquipoActivo();
  const rango = semanaChile(semana);
  const mes = mesChile(semana);
  const periodo = vista === 'semana' ? rango : mes;
  const citas = useCitas({ desde: periodo.desde, hasta: periodo.hasta, profesionalId: admin ? (profesionalId ?? undefined) : undefined });
  const setVista = (v: VistaAgenda) => {
    setVistaEstado(v);
    setSemana(0);
    try {
      localStorage.setItem(CLAVE_VISTA, v);
    } catch {
      // Almacen bloqueado: la preferencia dura solo esta visita.
    }
  };
  const equipo = useEquipoAgenda();
  const espacios = useEspacios();
  const pacientes = usePacientes();
  const nombres = nombresPacientes(pacientes.data);
  const ordenEquipo = (equipo.data ?? []).map((m) => m.id);
  const ordenBox = (espacios.data ?? []).map((e) => e.id);
  const nombreProfesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const nombreBox = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const hoy = dia(new Date());

  const visibles = (citas.data ?? []).filter((c) => c.estado !== 'CANCELADA');
  const dias = rango.dias.slice(0, visibles.some((c) => dia(new Date(c.inicio)) === rango.dias[5]) ? 6 : 5);
  const horas = visibles.map((c) => hora(c.inicio));
  const primera = Math.min(9, ...horas);
  const ultima = Math.max(19, ...horas);
  const filas = Array.from({ length: ultima - primera + 1 }, (_, i) => primera + i);
  const leyenda =
    modo === 'profesional'
      ? [...new Set(visibles.map((c) => c.profesionalId))].map((id) => ({
          id,
          nombre: nombreProfesional.get(id) ?? 'Profesional',
          tono: tonoDe(ordenEquipo, id),
        }))
      : [...new Set(visibles.map((c) => c.espacioId ?? 'online'))].map((id) => ({
          id,
          nombre: id === 'online' ? 'Online' : (nombreBox.get(id) ?? 'Box'),
          tono: id === 'online' ? TONOS[3]! : tonoDe(ordenBox, id),
        }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3.5">
        <div role="radiogroup" aria-label="Colorear por" className="flex rounded-full border border-divider bg-bg p-[3px]">
          {(['profesional', 'box'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modo === m}
              onClick={() => setModo(m)}
              className={`min-h-9 cursor-pointer rounded-full px-[17px] text-[12.5px] font-extrabold transition-colors duration-200 ${modo === m ? 'bg-accent-700 text-neutral-100' : 'text-neutral-700 hover:bg-accent-100'}`}
            >
              {m === 'profesional' ? 'Por profesional' : 'Por box'}
            </button>
          ))}
        </div>
        <SelectorPeriodo
          vista={vista}
          onVista={setVista}
          etiqueta={
            vista === 'semana' ? `Semana del ${mesLargo.format(new Date(`${rango.lunes}T12:00:00Z`))}` : mesTitulo.format(new Date(`${mes.primero}T12:00:00Z`))
          }
          desplazamiento={semana}
          onDesplazar={setSemana}
        />
        <ul className="m-0 ml-auto flex list-none flex-wrap items-center gap-3 p-0">
          {leyenda.map((l) => (
            <li key={l.id} className="inline-flex items-center gap-[7px] text-[12.5px] font-bold text-neutral-800">
              <span className={`size-[11px] rounded-[4px] border ${l.tono.muestra}`} aria-hidden />
              {l.nombre}
            </li>
          ))}
        </ul>
      </div>

      <EstadoConsulta consulta={citas}>
        {() =>
          vista === 'mes' ? (
            <section aria-label="Calendario del mes" className="overflow-x-auto rounded-[var(--radius-lg)] border border-divider bg-bg shadow-md">
              <div className="grid min-w-[760px] grid-cols-7">
                {DIAS_SEMANA.map((d) => (
                  <span
                    key={d}
                    className="border-b border-divider bg-neutral-200 px-3 py-2.5 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase"
                  >
                    {d}
                  </span>
                ))}
                {mes.dias.map((d) => {
                  const delMes = d.slice(0, 7) === mes.primero.slice(0, 7);
                  const enDia = visibles.filter((c) => dia(new Date(c.inicio)) === d).sort((a, b) => a.inicio.localeCompare(b.inicio));
                  return (
                    <div
                      key={d}
                      className={`flex min-h-[112px] min-w-0 flex-col gap-1 border-r border-b border-divider p-1.5 [&:nth-child(7n)]:border-r-0 ${delMes ? '' : 'bg-neutral-100'}`}
                    >
                      <span
                        className={`self-start rounded-full px-2 py-0.5 text-[12.5px] font-black tabular-nums ${d === hoy ? 'bg-accent-700 text-neutral-100' : delMes ? '' : 'text-neutral-700'}`}
                      >
                        {Number(d.slice(8))}
                        {d === hoy && <span className="sr-only"> (hoy)</span>}
                      </span>
                      {enDia.slice(0, MAX_EN_DIA).map((c) => {
                        const tono = modo === 'profesional' ? tonoDe(ordenEquipo, c.profesionalId) : c.espacioId ? tonoDe(ordenBox, c.espacioId) : TONOS[3]!;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => onElegir(c)}
                            className={`flex min-w-0 cursor-pointer items-center gap-1 rounded-lg border px-1.5 py-1 text-left text-[11.5px] font-bold focus-visible:outline-2 focus-visible:outline-accent-700 ${ESTILO_ESTADO[c.estado]}`}
                          >
                            <span className={`size-2 flex-none rounded-full border ${tono.muestra}`} aria-hidden />
                            <span className="tabular-nums">{String(hora(c.inicio)).padStart(2, '0')}h</span>
                            <span className={`truncate font-black ${tono.texto}`}>{nombreDeCita(nombres, c)}</span>
                          </button>
                        );
                      })}
                      {enDia.length > MAX_EN_DIA && (
                        <button
                          type="button"
                          onClick={() => {
                            // Semana que contiene ese dia, en la vista semanal.
                            const lunesHoy = semanaChile(0).lunes;
                            const dias = (new Date(`${d}T12:00:00Z`).getTime() - new Date(`${lunesHoy}T12:00:00Z`).getTime()) / 86_400_000;
                            setVistaEstado('semana');
                            setSemana(Math.floor(dias / 7));
                          }}
                          className="cursor-pointer self-start rounded-full px-1.5 text-[11.5px] font-extrabold text-accent-700 hover:bg-accent-200"
                        >
                          +{enDia.length - MAX_EN_DIA} más
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : (
            <section aria-label="Calendario de la semana" className="overflow-x-auto rounded-[var(--radius-lg)] border border-divider bg-bg shadow-md">
              <div className="min-w-[720px]">
                <div className="grid border-b border-divider bg-neutral-200" style={{ gridTemplateColumns: `74px repeat(${dias.length}, minmax(0, 1fr))` }}>
                  <span className="px-2.5 py-3 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Hora</span>
                  {dias.map((d) => (
                    <span
                      key={d}
                      className={`border-l border-divider px-3 py-3 text-[12.5px] font-black tracking-[-0.01em] first-letter:uppercase ${d === hoy ? 'text-accent-800' : ''}`}
                    >
                      {diaCorto.format(new Date(`${d}T12:00:00-04:00`))}
                      {d === hoy && <span className="sr-only"> (hoy)</span>}
                    </span>
                  ))}
                </div>
                {filas.map((h) => (
                  <div
                    key={h}
                    className="grid min-h-[62px] border-b border-divider last:border-b-0"
                    style={{ gridTemplateColumns: `74px repeat(${dias.length}, minmax(0, 1fr))` }}
                  >
                    <span className="bg-neutral-100 p-2.5 text-[12px] font-extrabold text-neutral-700 tabular-nums">{String(h).padStart(2, '0')}:00</span>
                    {dias.map((d) => {
                      const enCelda = visibles.filter((c) => dia(new Date(c.inicio)) === d && hora(c.inicio) === h);
                      return (
                        <div key={d} className={`flex min-w-0 flex-col gap-[5px] border-l border-divider p-[5px] ${enCelda.length ? '' : 'bg-neutral-100'}`}>
                          {enCelda.map((c) => {
                            const tono =
                              modo === 'profesional' ? tonoDe(ordenEquipo, c.profesionalId) : c.espacioId ? tonoDe(ordenBox, c.espacioId) : TONOS[3]!;
                            const pro = nombreProfesional.get(c.profesionalId) ?? 'Profesional';
                            const box = c.espacioId ? (nombreBox.get(c.espacioId) ?? 'Box') : 'Online';
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => onElegir(c)}
                                className={`flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-xl border-[1.5px] border-l-4 px-[9px] py-[7px] text-left transition-transform duration-200 ease-out hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-accent-700 motion-reduce:hover:translate-y-0 ${ESTILO_ESTADO[c.estado]} ${tono.borde}`}
                              >
                                <span className={`max-w-full truncate text-[12px] font-black tracking-[-0.01em] ${tono.texto}`}>
                                  {nombreDeCita(nombres, c)}
                                </span>
                                <span className="max-w-full truncate text-[11px] font-bold text-neutral-800">
                                  {modo === 'profesional' ? `${pro} · ${box}` : `${box} · ${pro}`}
                                </span>
                                <span className={`text-[11px] font-extrabold tracking-[0.06em] uppercase ${TEXTO_ESTADO[c.estado]}`}>
                                  {NOMBRE_ESTADO_CITA[c.estado]}
                                </span>
                              </button>
                            );
                          })}
                          {enCelda.length === 0 && <span className="px-1.5 py-1 text-[11px] font-semibold text-neutral-700">Libre</span>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>
          )
        }
      </EstadoConsulta>
    </div>
  );
}
