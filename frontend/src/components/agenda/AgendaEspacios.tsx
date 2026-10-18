'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Encabezado } from '@/components/shared/Encabezado';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pestanas } from '@/components/ui/Pestanas';
import { nombresPacientes, usePacientes, type CitaVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

import { AgendarSesion } from './AgendarSesion';
import { CalendarioAgenda } from './CalendarioAgenda';
import { DetalleCita } from './DetalleCita';
import { EspaciosAgenda } from './EspaciosAgenda';
import { HorariosEquipo } from './HorariosEquipo';
import { ListaEsperaEquipo } from './ListaEsperaEquipo';
import { PendientesAgenda } from './PendientesAgenda';

type Vista = 'calendario' | 'espacios' | 'equipo' | 'pendientes' | 'lista-espera';
const VISTAS: { valor: Vista; etiqueta: string }[] = [
  { valor: 'calendario', etiqueta: 'Calendario consolidado' },
  { valor: 'espacios', etiqueta: 'Espacios' },
  { valor: 'equipo', etiqueta: 'Horarios del equipo' },
  { valor: 'pendientes', etiqueta: 'Pendientes' },
  { valor: 'lista-espera', etiqueta: 'Lista de espera' },
];

/**
 * Agenda y Espacios (diseño "Admin - Agenda y Espacios"): calendario de la
 * semana, boxes, horas apartadas del equipo y pendientes. Parametros:
 * `?vista=`, `?nueva=1` (abre "Agendar sesion") y `?paciente=<id>`.
 */
export function AgendaEspacios({ rol }: { rol: Rol }) {
  const admin = esAdministracion(rol);
  const router = useRouter();
  const parametros = useSearchParams();
  // La lista de espera interna no es para practicantes (matriz).
  const vistas = VISTAS.filter((v) => v.valor !== 'lista-espera' || rol !== 'PRACTICANTE');
  const vista = vistas.find((v) => v.valor === parametros.get('vista'))?.valor ?? 'calendario';
  const agendar = parametros.get('nueva') === '1' || !!parametros.get('paciente');
  const [elegida, setElegida] = useState<CitaVista | null>(null);
  const [reprogramar, setReprogramar] = useState<CitaVista | null>(null);
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

  return (
    <>
      <Encabezado
        tono="team"
        sobretitulo="Agenda y Espacios"
        titulo={admin ? 'Coordinación del centro' : 'Mi agenda'}
        bajada={admin ? 'Todas las agendas del centro, los boxes y las horas apartadas.' : 'Tus sesiones, tus horas de box y lo pendiente.'}
        accion={
          <div className="flex flex-wrap gap-2.5">
            {admin && (
              <Button
                variant="secondary"
                icon="add"
                onClick={() => {
                  ir({ vista: 'espacios' });
                  setNuevoBox(true);
                }}
              >
                Agregar espacio
              </Button>
            )}
            <Button variant="team" icon="event" onClick={() => ir({ nueva: '1' })}>
              Agendar sesión
            </Button>
          </div>
        }
      />
      {admin && (
        <p className="m-0 mb-[22px] flex items-center gap-2 text-[13px] font-semibold text-neutral-700">
          <Icon name="groups" size={17} />
          Vista de coordinación: todas las agendas del centro (o la del profesional elegido en el menú lateral).
        </p>
      )}
      <div className="flex flex-col gap-5">
        <Pestanas
          etiqueta="Secciones de la agenda"
          tono="team"
          valor={vista}
          onChange={(v) => ir({ vista: v === 'calendario' ? null : v })}
          pestanas={VISTAS}
          panelId="agenda-panel"
        />
        <div id="agenda-panel" role="tabpanel">
          {vista === 'calendario' && <CalendarioAgenda rol={rol} onElegir={setElegida} />}
          {vista === 'espacios' && <EspaciosAgenda puedeEditar={admin} nuevo={nuevoBox} onNuevoCerrado={() => setNuevoBox(false)} />}
          {vista === 'equipo' && <HorariosEquipo rol={rol} />}
          {vista === 'pendientes' && <PendientesAgenda rol={rol} onElegir={setElegida} />}
          {vista === 'lista-espera' && <ListaEsperaEquipo rol={rol} />}
        </div>
      </div>

      <DetalleCita
        cita={elegida}
        nombrePaciente={elegida ? (nombres.get(elegida.pacienteId) ?? 'Paciente') : ''}
        rol={rol}
        onCerrar={() => setElegida(null)}
        onReprogramar={(c) => {
          setElegida(null);
          setReprogramar(c);
        }}
      />
      <AgendarSesion
        abierto={agendar || !!reprogramar}
        pacienteInicial={parametros.get('paciente') ?? undefined}
        reprogramar={reprogramar ?? undefined}
        onCerrar={() => {
          setReprogramar(null);
          if (agendar) ir({ nueva: null, paciente: null });
        }}
      />
    </>
  );
}
