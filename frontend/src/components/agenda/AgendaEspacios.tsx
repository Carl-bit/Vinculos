'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Pestanas } from '@/components/ui/Pestanas';
import { api, datos } from '@/lib/api/cliente';
import { nombreDeCita, nombresPacientes, usePacientes, type CitaVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { AgendarSesion } from './AgendarSesion';
import { CalendarioAgenda } from './CalendarioAgenda';
import { DetalleCita } from './DetalleCita';
import { EspaciosAgenda } from './EspaciosAgenda';
import type { HoraElegida } from './grillaAgenda';
import { HorariosEquipo } from './HorariosEquipo';
import { PendientesAgenda } from './PendientesAgenda';

type Vista = 'calendario' | 'espacios' | 'pendientes' | 'horarios';

/**
 * Agenda y Espacios (03b-4.2; Opcion A 2026-11-03): encabezado compacto,
 * pestañas "Mi horario" (o "Por profesional" para ADMIN/GESTION), "Espacios"
 * y "Pendientes". "Mi horario" une presencial y online con el panel lateral
 * de boxes (reemplaza la pestaña "Por box"). El calendario ocupa el alto de
 * la ventana.
 * "Horarios y boxes" (apartar horas de box y bloqueos) sale de las pestañas
 * y queda como accion del encabezado. Parametros: `?vista=`, `?nueva=1`
 * (abre "Agendar sesion"), `?paciente=<id>` y `?cita=<id>`.
 */
export function AgendaEspacios({ rol }: { rol: Rol }) {
  const admin = esAdministracion(rol);
  const router = useRouter();
  const parametros = useSearchParams();
  const pestanas: { valor: Vista; etiqueta: string }[] = [
    { valor: 'calendario', etiqueta: admin ? 'Por profesional' : 'Mi horario' },
    { valor: 'espacios', etiqueta: 'Espacios' },
    { valor: 'pendientes', etiqueta: 'Pendientes' },
  ];
  const pedida = parametros.get('vista');
  const vista: Vista = pedida === 'horarios' ? 'horarios' : (pestanas.find((v) => v.valor === pedida)?.valor ?? 'calendario');
  const agendar = parametros.get('nueva') === '1' || !!parametros.get('paciente');
  const [elegida, setElegida] = useState<CitaVista | null>(null);
  // `?cita=<id>` (desde un aviso o el inicio): abre el detalle de esa cita.
  const citaPedida = parametros.get('cita');
  const enlazada = useQuery({
    queryKey: ['panel', 'cita', citaPedida],
    queryFn: () => datos(api.GET('/api/citas/{id}', { params: { path: { id: citaPedida! } } })),
    enabled: !!citaPedida,
    retry: false,
  });
  const detalle = elegida ?? (citaPedida ? (enlazada.data ?? null) : null);
  const [reprogramar, setReprogramar] = useState<CitaVista | null>(null);
  const [hora, setHora] = useState<HoraElegida | null>(null);
  const [nuevoBox, setNuevoBox] = useState(false);
  const pacientes = usePacientes();
  const nombres = nombresPacientes(pacientes.data);

  const ir = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(parametros.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const q = p.toString();
    router.replace(q ? `/admin/agenda?${q}` : '/admin/agenda', { scroll: false });
  };
  const calendario = vista === 'calendario';

  return (
    // lg+: la agenda llena la ventana (alto menos el padding del main) y la grilla hace su propio scroll.
    <div className={`flex flex-col gap-2.5 ${calendario ? 'lg:h-[calc(100dvh-92px)]' : ''}`}>
      {/* Una sola linea (titulo, secciones y accion): la grilla gana alto sin achicar los botones. */}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] leading-tight font-black tracking-[-0.03em]">{admin ? 'Coordinación del centro' : 'Mi agenda'}</h1>
          <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
            {admin
              ? 'Las sesiones presenciales y online del equipo, con la disponibilidad de los boxes'
              : 'Tus sesiones presenciales y online, con la disponibilidad de los boxes'}
          </p>
        </div>
        {vista !== 'horarios' && (
          <Pestanas
            etiqueta="Secciones de la agenda"
            tono="team"
            valor={vista}
            onChange={(v) => ir({ vista: v === 'calendario' ? null : v })}
            pestanas={pestanas}
            panelId="agenda-panel"
          />
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="ghost" icon="schedule" onClick={() => ir({ vista: vista === 'horarios' ? null : 'horarios' })} className="!py-2 !text-[13px]">
            {vista === 'horarios' ? 'Volver a la agenda' : 'Horarios y boxes'}
          </Button>
          {admin && vista === 'espacios' && (
            <Button variant="secondary" icon="add" onClick={() => setNuevoBox(true)} className="!py-2 !text-[13px]">
              Agregar espacio
            </Button>
          )}
        </div>
      </header>
      <div id="agenda-panel" role="tabpanel" className={calendario ? 'flex min-h-0 flex-1 flex-col' : ''}>
        {calendario && (
          <CalendarioAgenda
            rol={rol}
            onElegir={setElegida}
            onAgendar={() => ir({ nueva: '1' })}
            onElegirHora={setHora}
            onVerPendientes={() => ir({ vista: 'pendientes' })}
          />
        )}
        {vista === 'espacios' && <EspaciosAgenda puedeEditar={admin} nuevo={nuevoBox} onNuevoCerrado={() => setNuevoBox(false)} />}
        {vista === 'pendientes' && <PendientesAgenda rol={rol} onElegir={setElegida} />}
        {vista === 'horarios' && <HorariosEquipo rol={rol} />}
      </div>

      <DetalleCita
        cita={detalle}
        nombrePaciente={detalle ? nombreDeCita(nombres, detalle) : ''}
        rol={rol}
        onCerrar={() => {
          setElegida(null);
          if (citaPedida) ir({ cita: null });
        }}
        onReprogramar={(c) => {
          setElegida(null);
          if (citaPedida) ir({ cita: null });
          setReprogramar(c);
        }}
      />
      <AgendarSesion
        key={hora?.inicio.toISOString() ?? 'agendar'}
        abierto={agendar || !!reprogramar || !!hora}
        rol={rol}
        pacienteInicial={parametros.get('paciente') ?? undefined}
        reprogramar={reprogramar ?? undefined}
        horaElegida={hora ?? undefined}
        onCerrar={() => {
          setReprogramar(null);
          setHora(null);
          if (agendar) ir({ nueva: null, paciente: null });
        }}
      />
    </div>
  );
}
