'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { GrillaTiempo, Marca, TarjetaCita, claseSesion, contarCitas, horaCorta, type ColumnaGrilla } from '@/components/shared/GrillaTiempo';
import { Button } from '@/components/ui/Button';
import { ControlSegmentado } from '@/components/ui/ControlSegmentado';
import { Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { useHorarioCentro } from '@/lib/centro';
import { useMiCuenta, useModulos } from '@/lib/consultas';
import { ESTADOS_VISUALES, estadoVisual, horaInicioCentro, tramosLibres, type EstadoVisual, type HoraElegida } from '@/lib/grillaAgenda';
import { DURACION_SESION_MIN, bloquesDeSesion, dia } from '@/lib/horarios';
import {
  fechaHoyChile,
  inicioDiaChile,
  instanteChile,
  mesChile,
  nombreDeCita,
  nombresPacientes,
  semanaChile,
  sumarDias,
  useAhora,
  useCitas,
  useEquipoAgenda,
  useEspacios,
  usePacientes,
  useRetencionesAjenas,
  type CitaVista,
} from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { PanelAgenda, type FiltroModalidad } from './PanelAgenda';

export type VistaAgenda = 'dia' | 'semana' | 'mes';

/** Preferencia sin datos sensibles: la ultima vista (dia, semana o mes). */
const CLAVE_VISTA = 'vinculos_vista_agenda';
const leer = (clave: string) => {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
};
const guardar = (clave: string, valor: string) => {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // Almacen bloqueado: la preferencia dura solo esta visita.
  }
};

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MAX_EN_DIA = 3;
const SEMANA_MS = 7 * 86_400_000;
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-CL', { timeZone: 'UTC', ...o });
const diaColumna = fmt({ weekday: 'short', day: 'numeric' });
const diaMes = fmt({ day: 'numeric', month: 'short' });
const diaLargo = fmt({ weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
const mesTitulo = fmt({ month: 'long', year: 'numeric' });
const mediodia = (d: string) => new Date(`${d}T12:00:00Z`);

/**
 * Fondo de la grilla (sin paciente ni quien): libre del box, disponible (hora sin sesion dentro de lo apartado por el
 * profesional), sesion ajena (ocupado), resto apartado por otro, apartado propio ya pasado o reservando.
 */
type ClaseFondo = 'libre' | 'disponible' | 'ocupado' | 'apartado' | 'propio' | 'reservando';
const TEXTO_FONDO: Record<ClaseFondo, string> = {
  libre: 'Libre',
  disponible: 'Disponible',
  ocupado: 'Ocupado',
  apartado: 'Apartado por otra persona',
  propio: 'Tu horario apartado',
  reservando: 'Reservando…',
};
/** ADMIN/GESTION con un profesional elegido: el bloque es de el, no de quien mira. */
const textoFondo = (clase: ClaseFondo, clinico: boolean) => (clase === 'propio' && !clinico ? 'Horario apartado' : TEXTO_FONDO[clase]);

type Evento =
  | { tipo: 'cita'; cita: CitaVista; inicio: string; fin: string }
  | { tipo: 'fondo'; clase: ClaseFondo; espacioId: string | null; inicio: string; fin: string; quien?: string; hora?: HoraElegida };

type Columna = ColumnaGrilla<Evento>;

/**
 * Calendario de la agenda (Opcion A, 2026-11-03): una sola vista con las
 * sesiones presenciales y online, mas un panel lateral (modalidad, boxes y
 * horas por confirmar). Dia | Semana | Mes en una grilla de tiempo real que va
 * de la apertura del centro (08:00 sin horario) a las 24:00.
 *
 * - Sesiones con el color de su modalidad (presencial / online / pago
 *   pendiente). ADMIN y GESTION ven todo el equipo o un profesional.
 * - Box elegido en el panel: encima las sesiones (del profesional; sin
 *   profesional elegido, las de ese box) y de fondo sus horas libres, lo
 *   apartado y cada sesion ajena como "Ocupado" (sesiones_espacios(), sin
 *   quien entre profesionales; ADMIN/GESTION con el nombre, desde los
 *   bloques). Las horas futuras libres del box o sin sesion en lo apartado se
 *   eligen para agendar presencial.
 * - Hora vacia a futuro (dia o semana): agenda una sesion online, que no ocupa
 *   box; la API verifica disponibilidad, margen y bloqueos al retenerla.
 *
 * Se refresca cada 2 minutos con la pestaña visible (estandar_polling.md).
 */
export function CalendarioAgenda({
  rol,
  onElegir,
  onAgendar,
  onElegirHora,
  onVerPendientes,
}: {
  rol: Rol;
  onElegir: (c: CitaVista) => void;
  onAgendar: () => void;
  onElegirHora: (h: HoraElegida) => void;
  onVerPendientes: () => void;
}) {
  const admin = esAdministracion(rol);
  const clinico = rol === 'PROFESIONAL' || rol === 'PRACTICANTE';
  const [vista, setVistaEstado] = useState<VistaAgenda>(() => {
    const v = leer(CLAVE_VISTA);
    return v === 'mes' || v === 'dia' ? v : 'semana';
  });
  const [desplazamiento, setDesplazamiento] = useState(0);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [modalidad, setModalidad] = useState<FiltroModalidad>('todas');
  const { profesionalId, setProfesionalId } = useEquipoActivo();
  const cuenta = useMiCuenta();
  const modulos = useModulos();
  const ahora = useAhora();
  const desdeHora = horaInicioCentro(useHorarioCentro().data);

  const hoy = fechaHoyChile();
  const diaVista = sumarDias(hoy, vista === 'dia' ? desplazamiento : 0);
  const semana = semanaChile(vista === 'semana' ? desplazamiento : 0);
  const mes = mesChile(vista === 'mes' ? desplazamiento : 0);
  const rango =
    vista === 'dia'
      ? { desde: inicioDiaChile(diaVista).toISOString(), hasta: inicioDiaChile(sumarDias(diaVista, 1)).toISOString() }
      : vista === 'semana'
        ? { desde: semana.desde, hasta: semana.hasta }
        : { desde: mes.desde, hasta: mes.hasta };
  const filtro = admin ? (profesionalId ?? undefined) : undefined;
  const box = boxId;

  const citas = useCitas({ ...rango, profesionalId: filtro }, true, { sondeo: true });
  const reservando = useRetencionesAjenas({ ...rango, profesionalId: filtro }).data ?? [];
  const equipo = useEquipoAgenda();
  const espacios = useEspacios();
  const pacientes = usePacientes();
  // Boxes del panel: horario libre, lo apartado y lo ocupado (sin quien); el profesional distingue lo que aparto el.
  const ocupacion = useQuery({
    queryKey: ['panel', 'espacios', 'ocupacion', rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/espacios/ocupacion', { params: { query: rango } })),
  });
  const sesionesBox = useQuery({
    queryKey: ['panel', 'espacios', 'sesiones', rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/espacios/sesiones', { params: { query: rango } })),
  });
  const libres = useQuery({
    queryKey: ['panel', 'espacios', 'disponibilidad', rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/espacios/disponibilidad', { params: { query: rango } })),
  });
  const propios = useQuery({
    queryKey: ['panel', 'bloques', cuenta.data?.id, rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/profesionales/{profesionalId}/bloques', { params: { path: { profesionalId: cuenta.data!.id }, query: rango } })),
    enabled: !!box && clinico && !!cuenta.data?.id,
  });
  const bloquesCentro = useQuery({
    queryKey: ['panel', 'bloques', 'centro', rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/espacios/bloques', { params: { query: rango } })),
    enabled: !!box && admin,
  });
  // Simbolos de estado: sesiones con evolucion (solo el equipo tratante: es clinico) e inasistencias (Cobros).
  const evolucion = useQuery({
    queryKey: ['panel', 'citas-con-evolucion', rango.desde, rango.hasta],
    queryFn: () => datos(api.GET('/api/citas-con-evolucion', { params: { query: rango } })),
    enabled: clinico,
  });
  const cobros = useQuery({
    queryKey: ['panel', 'cobros-citas', rango.desde, rango.hasta, filtro],
    queryFn: () => datos(api.GET('/api/cobros/citas', { params: { query: { ...rango, profesionalId: filtro } } })),
    enabled: rol !== 'PRACTICANTE' && !!modulos.data?.activos.includes('COBROS'),
  });

  const setVista = (v: VistaAgenda) => {
    setVistaEstado(v);
    setDesplazamiento(0);
    guardar(CLAVE_VISTA, v);
  };

  const nombres = nombresPacientes(pacientes.data);
  const nombreProfesional = new Map((equipo.data ?? []).map((m) => [m.id, m.nombre ?? 'Profesional']));
  const activos = (espacios.data ?? []).filter((e) => e.activo);
  const nombreBox = new Map((espacios.data ?? []).map((e) => [e.id, e.nombre]));
  const conEvolucion = new Set(evolucion.data ?? []);
  const inasistencias = new Set((cobros.data ?? []).filter((c) => c.inasistencia).map((c) => c.cita_id));

  const visibles = (citas.data ?? []).filter((c) => c.estado !== 'CANCELADA' && c.estado !== 'LIBERADA');
  const variosProfesionales = admin && !filtro;
  const estadoDe = (c: CitaVista) =>
    estadoVisual(c, { ahora, conEvolucion: clinico && evolucion.isSuccess ? conEvolucion.has(c.id) : undefined, inasistencia: inasistencias.has(c.id) });

  // Quien aparto un bloque: solo llega a ADMIN/GESTION.
  const quienAparto = (o: { espacio_id: string; inicio: string; fin: string }) => {
    const b = bloquesCentro.data?.find((x) => x.espacioId === o.espacio_id && x.inicio <= o.inicio && x.fin >= o.fin);
    return b && (nombreProfesional.get(b.profesionalId) ?? 'Profesional');
  };

  // Encima, las sesiones del profesional (todas: un choque puede ser en otro box u online) o, para ADMIN/GESTION
  // sin profesional elegido y con un box, las de ese box. De fondo, las horas libres del box y lo apartado.
  const sesiones = visibles.filter((c) => (modalidad === 'todas' || c.modalidad === modalidad) && (!box || clinico || !!filtro || c.espacioId === box));
  const ms = (iso: string) => new Date(iso).getTime();
  const enCartas = new Set(visibles.filter((c) => c.espacioId === box).map((c) => ms(c.inicio)));
  const sesionesDelBox = (sesionesBox.data ?? []).filter((s) => s.espacio_id === box);
  // Lo apartado por el profesional en foco es suyo: para ADMIN/GESTION sale de los bloques del centro.
  const foco = clinico ? cuenta.data?.id : (filtro ?? undefined);
  const bloquesFoco = (clinico ? propios.data : bloquesCentro.data?.filter((b) => b.profesionalId === filtro)) ?? [];
  // Horas a futuro de un tramo, para agendar con un clic; un tramo ya pasado queda como fondo sin accion.
  const horasOFondo = (tramo: { inicio: string; fin: string }, clase: ClaseFondo, claseHora: ClaseFondo, apartar: boolean, quien?: string): Evento[] => {
    const horas = box ? bloquesDeSesion([{ modalidad: 'PRESENCIAL', ...tramo }], new Date(ahora)) : [];
    if (horas.length === 0) return [{ tipo: 'fondo', clase, espacioId: box, ...tramo, quien }];
    return horas.map((h) => ({
      tipo: 'fondo',
      clase: claseHora,
      espacioId: box,
      inicio: h.inicio.toISOString(),
      fin: h.fin.toISOString(),
      hora: { inicio: h.inicio, fin: h.fin, espacioId: box!, nombreBox: nombreBox.get(box!) ?? 'Box', profesionalId: foco, apartar },
    }));
  };
  const fondo: Evento[] = [
    ...(box
      ? [
          ...(libres.data ?? []).filter((l) => l.espacioId === box).flatMap((l) => horasOFondo({ inicio: l.inicio, fin: l.fin }, 'libre', 'libre', true)),
          ...(ocupacion.data ?? [])
            .filter((o) => o.espacio_id === box)
            .flatMap((o): Evento[] => {
              const suyo = bloquesFoco.some((b) => b.espacioId === o.espacio_id && b.inicio <= o.inicio && b.fin >= o.fin);
              const tramos = tramosLibres(o, sesionesDelBox);
              const quien = quienAparto(o);
              if (suyo) return tramos.flatMap((t) => horasOFondo(t, 'propio', 'disponible', false, quien));
              return tramos.map((t) => ({ tipo: 'fondo', clase: 'apartado', espacioId: box, ...t, quien }));
            }),
          // Sesiones de otros: una por una, sin paciente (y sin quien entre profesionales).
          ...sesionesDelBox
            .filter((s) => !enCartas.has(ms(s.inicio)))
            .map((s) => ({ tipo: 'fondo' as const, clase: 'ocupado' as const, espacioId: box, inicio: s.inicio, fin: s.fin, quien: quienAparto(s) })),
        ]
      : []),
    ...reservando
      .filter((r) => !box || r.espacioId === box)
      .map((r) => ({ tipo: 'fondo' as const, clase: 'reservando' as const, espacioId: r.espacioId, inicio: r.inicio, fin: r.fin })),
  ];
  const eventos: Evento[] = [...sesiones.map((c) => ({ tipo: 'cita' as const, cita: c, inicio: c.inicio, fin: c.fin })), ...fondo];
  const delDia = (d: string) => eventos.filter((e) => dia(new Date(e.inicio)) === d);

  // Hora vacia a futuro: sesion online (sin box). Solo si el filtro deja ver online y no pisa una sesion dibujada.
  const conOnline = vista !== 'mes' && modalidad !== 'PRESENCIAL';
  const huecosOnline = (d: string): HoraElegida[] => {
    if (!conOnline) return [];
    const salida: HoraElegida[] = [];
    for (let h = desdeHora; h < 24; h++) {
      const inicio = instanteChile(d, h * 60);
      const fin = new Date(inicio.getTime() + DURACION_SESION_MIN * 60_000);
      if (inicio.getTime() <= ahora) continue;
      if (sesiones.some((c) => ms(c.inicio) < fin.getTime() && ms(c.fin) > inicio.getTime())) continue;
      salida.push({ inicio, fin, espacioId: null, nombreBox: 'Online', profesionalId: foco, apartar: false });
    }
    return salida;
  };

  const finDeSemana = vista === 'semana' && eventos.some((e) => [semana.dias[5], semana.dias[6]].includes(dia(new Date(e.inicio))));
  const columnas: Columna[] = (vista === 'dia' ? [diaVista] : semana.dias.slice(0, finDeSemana ? 7 : 5)).map((d) => ({
    clave: d,
    titulo: diaColumna.format(mediodia(d)),
    dia: d,
    eventos: delDia(d),
  }));

  const etiqueta =
    vista === 'dia'
      ? diaLargo.format(mediodia(diaVista))
      : vista === 'semana'
        ? `${diaMes.format(mediodia(semana.dias[0]!))} – ${diaMes.format(mediodia(semana.dias[6]!))}`
        : mesTitulo.format(mediodia(mes.primero));
  const unidad = vista === 'dia' ? 'Día' : vista === 'semana' ? 'Semana' : 'Mes';
  const etiquetaRango = vista === 'dia' ? 'En el día' : vista === 'semana' ? 'En la semana' : 'En el mes';
  const conteo = {
    presencial: visibles.filter((c) => c.modalidad === 'PRESENCIAL').length,
    online: visibles.filter((c) => c.modalidad === 'ONLINE').length,
  };
  const rangoConAhora = ms(rango.desde) <= ahora && ahora < ms(rango.hasta);

  const estadosPresentes = [...new Set(sesiones.map(estadoDe).filter((e): e is EstadoVisual => !!e))];
  const fondosPresentes = [...new Set(fondo.flatMap((f) => (f.tipo === 'fondo' && f.clase !== 'libre' ? [f.clase] : [])))];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="toolbar" aria-label="Controles de la agenda" className="flex flex-wrap items-center gap-2.5">
        <ControlSegmentado
          etiqueta="Vista de la agenda"
          tono="team"
          valor={vista}
          onChange={setVista}
          opciones={[
            { valor: 'dia', etiqueta: 'Día', icono: 'view_day' },
            { valor: 'semana', etiqueta: 'Semana', icono: 'view_week' },
            { valor: 'mes', etiqueta: 'Mes', icono: 'calendar_view_month' },
          ]}
        />
        <div className="flex items-center gap-1">
          <BotonIcono etiqueta={`${unidad} anterior`} icono="chevron_left" onClick={() => setDesplazamiento((n) => n - 1)} />
          <Button variant="secondary" disabled={desplazamiento === 0} onClick={() => setDesplazamiento(0)} className="!min-h-10 !px-4 !py-2 !text-[13px]">
            Hoy
          </Button>
          <BotonIcono etiqueta={`${unidad} siguiente`} icono="chevron_right" onClick={() => setDesplazamiento((n) => n + 1)} />
        </div>
        <h2 aria-live="polite" className="m-0 min-w-[130px] text-[15px] font-black tracking-[-0.01em] first-letter:uppercase">
          {etiqueta}
        </h2>
        {admin && (
          // Mismo filtro que "Viendo a" (EquipoActivo): la cuenta madre lo elige aca.
          <Select
            aria-label="Profesional de la agenda"
            value={profesionalId ?? ''}
            onChange={(e) => setProfesionalId(e.target.value || null)}
            className="!min-h-10 !w-auto !py-1.5 !text-[13px]"
          >
            <option value="">Todo el equipo</option>
            {(equipo.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre ?? 'Profesional'}
              </option>
            ))}
          </Select>
        )}
        <Button variant="team" icon="event" onClick={onAgendar} className="ml-auto">
          Agendar sesión
        </Button>
      </div>

      <Leyenda
        estados={estadosPresentes}
        fondos={fondosPresentes}
        clinico={clinico}
        box={box ? (nombreBox.get(box) ?? 'Box') : null}
        ayuda={
          conOnline ? (box ? 'Toca una hora vacía para agendar online o una libre del box para presencial' : 'Toca una hora vacía para agendar online') : null
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EstadoConsulta consulta={citas}>
            {() =>
              vista === 'mes' ? (
                <VistaMes
                  mes={mes}
                  hoy={hoy}
                  eventos={eventos}
                  etiquetaCita={(c) => nombreDeCita(nombres, c)}
                  estadoDe={estadoDe}
                  onElegir={onElegir}
                  onDia={(d) => {
                    setVistaEstado('semana');
                    setDesplazamiento(Math.floor((mediodia(d).getTime() - mediodia(semanaChile(0).dias[0]!).getTime()) / SEMANA_MS));
                  }}
                />
              ) : (
                <GrillaTiempo
                  columnas={columnas}
                  hoy={hoy}
                  ahora={ahora}
                  desdeHora={desdeHora}
                  huecos={huecosOnline}
                  onHueco={onElegirHora}
                  render={(e) =>
                    e.tipo === 'fondo' ? (
                      e.hora ? (
                        <HoraDisponible clase={e.clase} hora={e.hora} onElegir={onElegirHora} />
                      ) : (
                        <Fondo
                          clase={e.clase}
                          clinico={clinico}
                          lugar={box ? (e.quien ?? null) : e.espacioId ? (nombreBox.get(e.espacioId) ?? 'Box') : 'Online'}
                        />
                      )
                    ) : (
                      <TarjetaCita
                        cita={e.cita}
                        paciente={nombreDeCita(nombres, e.cita)}
                        profesional={variosProfesionales ? (nombreProfesional.get(e.cita.profesionalId) ?? 'Profesional') : undefined}
                        box={e.cita.espacioId ? (nombreBox.get(e.cita.espacioId) ?? 'Box') : null}
                        estado={estadoDe(e.cita)}
                        encima={!!box}
                        onElegir={onElegir}
                      />
                    )
                  }
                />
              )
            }
          </EstadoConsulta>
        </div>
        <PanelAgenda
          etiquetaRango={etiquetaRango}
          modalidad={modalidad}
          onModalidad={setModalidad}
          conteo={conteo}
          espacios={activos}
          libres={libres.data ?? []}
          ocupacion={ocupacion.data ?? []}
          sesionesBox={sesionesBox.data ?? []}
          boxId={box}
          onBox={setBoxId}
          ahora={ahora}
          rangoConAhora={rangoConAhora}
          profesionalId={filtro}
          nombres={nombres}
          onElegir={onElegir}
          onVerPendientes={onVerPendientes}
        />
      </div>
    </div>
  );
}

function BotonIcono({ etiqueta, icono, onClick }: { etiqueta: string; icono: 'chevron_left' | 'chevron_right'; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      onClick={onClick}
      className="grid size-10 cursor-pointer place-items-center rounded-full hover:bg-accent-200 focus-visible:outline-2 focus-visible:outline-accent-700"
    >
      <Icon name={icono} />
    </button>
  );
}

const CLASE_FONDO: Record<ClaseFondo, string> = {
  libre: 'border-2 border-dashed border-accent-2-700 bg-accent-2-200/55 text-accent-2-800',
  disponible: 'border-dashed border-accent-500 bg-accent-100/70 text-accent-800',
  ocupado: 'border-neutral-400 bg-neutral-200 text-neutral-800',
  apartado: 'border-transparent bg-neutral-200/40 text-neutral-800',
  propio: 'border-accent-500 bg-accent-100/70 text-accent-800',
  reservando: 'border-dashed border-neutral-500 bg-neutral-200/70 text-neutral-800',
};

/** Bloque de fondo (sin paciente ni quien). */
function Fondo({ clase, lugar, clinico }: { clase: ClaseFondo; lugar: string | null; clinico: boolean }) {
  return (
    <span
      className={`flex h-full min-w-0 flex-col overflow-hidden rounded-[10px] border px-1.5 py-1 text-[11px] leading-tight font-bold ${CLASE_FONDO[clase]}`}
    >
      {clase !== 'apartado' && <span className="truncate font-black">{textoFondo(clase, clinico)}</span>}
      {lugar && <span className="truncate">{lugar}</span>}
    </span>
  );
}

/** Hora libre o disponible del box: abre "Agendar sesion" con esa hora. */
function HoraDisponible({ clase, hora, onElegir }: { clase: ClaseFondo; hora: HoraElegida; onElegir: (h: HoraElegida) => void }) {
  const texto = horaCorta.format(hora.inicio);
  return (
    <button
      type="button"
      onClick={() => onElegir(hora)}
      aria-label={`Agendar sesión a las ${texto}, ${hora.nombreBox}`}
      className={`flex h-full w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-[10px] border px-1.5 py-1 text-left text-[11px] leading-tight font-bold transition-shadow duration-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent-700 ${CLASE_FONDO[clase]}`}
    >
      <span className="truncate font-black">
        <span className="tabular-nums">{texto}</span> {clase === 'libre' ? `Libre en ${hora.nombreBox}` : TEXTO_FONDO[clase]}
      </span>
    </button>
  );
}

function Leyenda({
  estados,
  fondos,
  clinico,
  box,
  ayuda,
}: {
  estados: EstadoVisual[];
  fondos: ClaseFondo[];
  clinico: boolean;
  box: string | null;
  ayuda: string | null;
}) {
  // Pago pendiente y sin evolucion llevan marca propia; el resto de los estados presentes, su simbolo.
  const otros = estados.filter((e) => e !== 'confirmada' && e !== 'pendiente_pago' && e !== 'retenida' && e !== 'sin_evolucion');
  const muestra = 'size-[13px] flex-none rounded-[4px]';
  return (
    <ul aria-label="Leyenda" className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-[12px] font-bold text-neutral-800">
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className={`${muestra} border border-presencial-600 bg-presencial-200`} />
        Presencial
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className={`${muestra} border border-online-600 bg-online-100`} />
        Online
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className={`${muestra} border-2 border-dashed border-pendiente-700 bg-pendiente-100`} />
        Pago pendiente
      </li>
      {clinico && (
        <li className="inline-flex items-center gap-1.5">
          <Marca tono="oscuro">SIN EVOL.</Marca>
          Sin evolución
        </li>
      )}
      {otros.map((e) => (
        <li key={e} className="inline-flex items-center gap-1">
          <Icon name={ESTADOS_VISUALES[e].icono} size={15} className="text-neutral-700" />
          {ESTADOS_VISUALES[e].texto}
        </li>
      ))}
      {fondos.map((f) => (
        <li key={f} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`${muestra} border ${CLASE_FONDO[f]}`} />
          {f === 'ocupado' || f === 'reservando' ? `${TEXTO_FONDO[f]} por otra persona` : textoFondo(f, clinico)}
        </li>
      ))}
      {ayuda && <li className="font-semibold text-neutral-700">{ayuda}</li>}
      {box && (
        <li className="inline-flex items-center gap-1.5 font-extrabold text-accent-2-800 sm:ml-auto">
          <span aria-hidden className={`${muestra} ${CLASE_FONDO.libre}`} />
          Horas libres de {box}
        </li>
      )}
    </ul>
  );
}

function VistaMes({
  mes,
  hoy,
  eventos,
  etiquetaCita,
  estadoDe,
  onElegir,
  onDia,
}: {
  mes: { primero: string; dias: string[] };
  hoy: string;
  eventos: Evento[];
  etiquetaCita: (c: CitaVista) => string;
  estadoDe: (c: CitaVista) => EstadoVisual | null;
  onElegir: (c: CitaVista) => void;
  onDia: (d: string) => void;
}) {
  return (
    <section aria-label="Calendario del mes" className="min-h-[420px] flex-1 overflow-auto rounded-[var(--radius-lg)] border border-divider bg-bg shadow-md">
      <div className="grid min-w-[760px] grid-cols-7">
        {DIAS_SEMANA.map((d) => (
          <span
            key={d}
            className="sticky top-0 z-[1] border-b border-divider bg-neutral-200 px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase"
          >
            {d}
          </span>
        ))}
        {mes.dias.map((d) => {
          const delMes = d.slice(0, 7) === mes.primero.slice(0, 7);
          const enDia = eventos
            .filter((e): e is Extract<Evento, { tipo: 'cita' }> => e.tipo === 'cita' && dia(new Date(e.inicio)) === d)
            .sort((a, b) => a.inicio.localeCompare(b.inicio));
          return (
            <div
              key={d}
              className={`flex min-h-[104px] min-w-0 flex-col gap-1 border-r border-b border-divider p-1.5 [&:nth-child(7n)]:border-r-0 ${delMes ? '' : 'bg-neutral-100'}`}
            >
              <button
                type="button"
                onClick={() => onDia(d)}
                aria-label={`Ver la semana del ${Number(d.slice(8))}${enDia.length ? `, ${contarCitas(enDia.length)}` : ''}`}
                className="flex cursor-pointer items-center justify-between gap-1 rounded-full px-1 hover:bg-accent-100"
              >
                <span
                  className={`rounded-full px-2 py-0.5 text-[12.5px] font-black tabular-nums ${d === hoy ? 'bg-accent-700 text-neutral-100' : delMes ? '' : 'text-neutral-700'}`}
                >
                  {Number(d.slice(8))}
                </span>
                {enDia.length > 0 && <span className="text-[11px] font-extrabold text-neutral-700 tabular-nums">{enDia.length}</span>}
              </button>
              {enDia.slice(0, MAX_EN_DIA).map(({ cita: c }) => {
                const e = estadoDe(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onElegir(c)}
                    className={`flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-[11.5px] font-bold focus-visible:outline-2 focus-visible:outline-accent-700 ${claseSesion(c, e)}`}
                  >
                    {e && <Icon name={ESTADOS_VISUALES[e].icono} size={13} className="flex-none" />}
                    <span className="tabular-nums">{horaCorta.format(new Date(c.inicio))}</span>
                    <span className="truncate font-black">{etiquetaCita(c)}</span>
                  </button>
                );
              })}
              {enDia.length > MAX_EN_DIA && (
                <button
                  type="button"
                  onClick={() => onDia(d)}
                  className="cursor-pointer self-start rounded-full px-1.5 text-[12px] font-extrabold text-accent-700 hover:bg-accent-200"
                >
                  +{enDia.length - MAX_EN_DIA} más
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
