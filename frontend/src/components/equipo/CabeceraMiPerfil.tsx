'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import { ApiError } from '@/lib/api/errores';
import { usePerfilProfesional } from '@/lib/equipo';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { fechaHoyChile, nombreDeCita, nombresPacientes, sumarDias, useCitas, useDashboard, useEspacios, usePacientes, inicioDiaChile } from '@/lib/panel';
import { NOMBRE_ROL } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';
import { subirArchivo } from '@/lib/subidas';

/**
 * Cabecera de "Mi perfil" (diseño "Admin - Mi Perfil"): foto (el propio
 * profesional la cambia), nombre, especialidad, roles, accesos al perfil
 * publico y al equipo, indicadores propios y la proxima sesion. Los
 * indicadores son los del rol activo clinico (la API los entrega por rol).
 */
export function CabeceraMiPerfil({ usuarioId, nombre, roles, rolActivo }: { usuarioId: string; nombre: string; roles: Rol[]; rolActivo: Rol }) {
  const cliente = useQueryClient();
  const atiende = roles.includes('PROFESIONAL');
  const clinico = rolActivo === 'PROFESIONAL' || rolActivo === 'PRACTICANTE';
  const perfil = usePerfilProfesional(atiende ? usuarioId : undefined).data;
  const tablero = useDashboard().data;
  const [error, setError] = useState<string>();
  const archivo = useRef<HTMLInputElement>(null);
  const subir = useMutation({
    mutationFn: (a: File) => subirArchivo<{ fotoUrl: string }>('/api/profesionales/yo/foto', 'imagen', a),
    onSuccess: () => {
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['equipo', 'perfil', usuarioId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos subir la foto.'),
  });
  const visible = perfil?.nombrePublico || nombre;
  const indicadores: { icono: Icono; etiqueta: string; valor: string | number }[] =
    clinico && tablero
      ? [
          { icono: 'event', etiqueta: 'Sesiones esta semana', valor: tablero.sesiones_semana ?? 0 },
          { icono: 'group', etiqueta: 'Pacientes activos', valor: tablero.pacientes_activos },
          { icono: 'folder_open', etiqueta: 'Fichas sin cerrar', valor: tablero.fichas_sin_cerrar ?? 0 },
          ...(rolActivo === 'PROFESIONAL'
            ? [
                {
                  icono: 'star_border' as Icono,
                  etiqueta: 'Mi calificación',
                  valor: tablero.calificacion ? tablero.calificacion.toFixed(1).replace('.', ',') : '—',
                },
              ]
            : []),
        ]
      : [];

  return (
    <section
      aria-labelledby="mi-perfil-nombre"
      className="rounded-lg border border-divider bg-bg px-[clamp(20px,3vw,36px)] pt-[clamp(22px,3vw,34px)] pb-6 shadow-md"
    >
      <div className="grid items-center gap-x-8 gap-y-6 md:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_minmax(0,400px)]">
        <div className="relative w-fit">
          <AvatarProfesional nombre={visible} foto={perfil?.fotoUrl ?? null} size={156} />
          {perfil && (
            <>
              <input
                ref={archivo}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Elegir foto de perfil"
                onChange={(e) => {
                  const a = e.target.files?.[0];
                  if (a) subir.mutate(a);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => archivo.current?.click()}
                aria-label="Cambiar mi foto"
                className="absolute right-1 bottom-2 grid size-11 cursor-pointer place-items-center rounded-full border border-divider bg-bg text-text shadow-md transition-colors duration-200 hover:bg-accent-200"
              >
                <Icon name={subir.isPending ? 'progress_activity' : 'photo_camera'} size={20} />
              </button>
            </>
          )}
        </div>
        <div className="min-w-0">
          <Eyebrow tone="team">Mi perfil</Eyebrow>
          <h1 id="mi-perfil-nombre" className="m-0 mb-2 text-[clamp(32px,4.2vw,50px)] leading-[0.98] font-black tracking-[-0.04em] text-balance">
            {visible}
          </h1>
          {perfil?.especialidad && <p className="m-0 mb-3 text-[17px] font-semibold text-neutral-800">{perfil.especialidad}</p>}
          <div className="mb-5 flex flex-wrap gap-1.5">
            <Badge tono="positivo">{roles.map((r) => NOMBRE_ROL[r]).join(' · ')}</Badge>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {perfil?.perfilPublico && (
              <ButtonLink href={`/equipo/${usuarioId}`} variant="team" icon="public">
                Ver cómo me ven los pacientes
              </ButtonLink>
            )}
            <ButtonLink href={roles.includes('ADMIN') || roles.includes('GESTION') ? '/admin/equipo' : '/equipo'} variant="secondary" icon="groups">
              Ver el equipo
            </ButtonLink>
          </div>
          {error && (
            <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
        </div>
        {indicadores.length > 0 && (
          <ul aria-label="Mis indicadores" className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4 md:col-span-2 xl:col-span-1 xl:grid-cols-3">
            {indicadores.map((i) => (
              <li key={i.etiqueta} className="flex min-w-[118px] flex-col gap-2.5 rounded-[18px] border border-divider bg-neutral-100 px-4 py-3.5">
                <span className="flex items-start gap-1.5 text-[10.5px] leading-tight font-extrabold tracking-[0.12em] text-neutral-700 uppercase">
                  <Icon name={i.icono} size={15} />
                  {i.etiqueta}
                </span>
                <span className="text-[26px] leading-none font-black tracking-[-0.03em] tabular-nums">{i.valor}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {clinico && <ProximaSesion />}
      {!clinico && atiende && (
        <p className="m-0 mt-6 border-t border-divider pt-5 text-[13.5px] font-semibold text-neutral-800">
          Estás trabajando como {NOMBRE_ROL[rolActivo]}. Cambia a tu rol de profesional (selector de rol del menú) para ver tus indicadores y tu agenda.
        </p>
      )}
    </section>
  );
}

/** Proxima sesion propia (citas de las proximas dos semanas; el nombre sale de mis pacientes). */
function ProximaSesion() {
  const hoy = fechaHoyChile();
  const citas = useCitas({ desde: inicioDiaChile(hoy).toISOString(), hasta: inicioDiaChile(sumarDias(hoy, 15)).toISOString() });
  const nombres = nombresPacientes(usePacientes().data);
  const boxes = new Map((useEspacios().data ?? []).map((e) => [e.id, e.nombre]));
  const proxima = (citas.data ?? [])
    .filter((c) => (c.estado === 'CONFIRMADA' || c.estado === 'PENDIENTE_PAGO') && new Date(c.fin).getTime() > Date.now())
    .sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
  const dia =
    proxima && (new Date(proxima.inicio).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' }) === hoy ? 'Hoy' : formatoFechaLarga(proxima.inicio));
  return (
    <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-divider pt-5">
      <Icon name="event_upcoming" size={22} className="text-neutral-700" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">Mi próxima sesión</div>
        <div className="text-[16px] font-black tracking-[-0.02em]">
          {proxima
            ? `${dia}, ${formatoHora(proxima.inicio)} · ${nombreDeCita(nombres, proxima)} · ${proxima.modalidad === 'ONLINE' ? 'Online' : (boxes.get(proxima.espacioId ?? '') ?? 'Presencial')}`
            : 'Sin sesiones en las próximas dos semanas'}
        </div>
      </div>
      <Link
        href="/admin/agenda"
        className="rounded-full border-[1.5px] border-neutral-400 px-5 py-2.5 text-sm font-extrabold whitespace-nowrap text-text hover:border-accent-500 hover:bg-accent-200 hover:text-text"
      >
        Ver mi agenda
      </Link>
    </div>
  );
}
