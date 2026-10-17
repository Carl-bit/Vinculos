import Link from 'next/link';

import { EstadoVista } from '@/components/shared/EstadoVista';
import { LlamadoAccion } from '@/components/shared/LlamadoAccion';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { EnlaceVolver } from '@/components/ui/EnlaceVolver';
import { Eyebrow } from '@/components/ui/Eyebrow';
import type { PerfilPublico, ResenaPublica } from '@/lib/api/servidor';
import { nombreCorto, tiposDeAtencion } from '@/lib/perfiles';

import { Resenas, SeccionesPerfil } from './PerfilCompleto';
import { CabeceraPerfil, DatosPerfil, TarjetaPerfil } from './TarjetaPerfil';

const chip = (activo: boolean) =>
  `inline-flex min-h-10 items-center rounded-full border-[1.5px] px-[18px] text-[13.5px] font-extrabold transition-colors duration-200 ${
    activo
      ? 'border-accent-2-600 bg-accent-2-200 text-accent-2-900 hover:text-accent-2-900'
      : 'border-neutral-400 bg-bg text-text hover:border-accent-500 hover:text-text'
  }`;

/**
 * Equipo publico (diseño "Equipo Publico"). El filtro por tipo de atencion va
 * en la URL (?atencion=): funciona sin JS y se puede compartir.
 */
export function EquipoPublico({ perfiles, atencion, agenda, match }: { perfiles: PerfilPublico[]; atencion?: string; agenda: boolean; match: boolean }) {
  const tipos = tiposDeAtencion(perfiles);
  const filtro = atencion && tipos.includes(atencion) ? atencion : null;
  const lista = filtro ? perfiles.filter((p) => p.tipos_atencion.includes(filtro)) : perfiles;
  return (
    <>
      <section className="entrada pt-[clamp(18px,3vw,38px)] pb-[clamp(24px,3vw,34px)]">
        <Eyebrow>Conoce a nuestro equipo</Eyebrow>
        <h1 className="m-0 mb-[18px] max-w-[24ch] text-[clamp(34px,5vw,58px)] leading-[0.99] font-black tracking-[-0.035em] text-balance">
          Quiénes somos y con quién puedes atenderte
        </h1>
        <p className="m-0 max-w-[56ch] text-[17.5px] leading-relaxed text-pretty text-neutral-700">
          Cada ficha muestra la formación verificada, el enfoque y las tarifas de la persona.
          {agenda && ' Puedes pedir hora directamente con quien quieras, sin crear una cuenta antes.'}
        </p>
      </section>

      {tipos.length > 1 && (
        <nav aria-label="Filtrar por tipo de atención" className="mb-[26px] flex flex-wrap items-center gap-2.5 border-b border-divider pb-[22px]">
          <span className="mr-1.5 text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">Filtrar por atención</span>
          <Link href="/equipo" scroll={false} aria-current={!filtro ? 'page' : undefined} className={chip(!filtro)}>
            Todo el equipo
          </Link>
          {tipos.map((t) => (
            <Link
              key={t}
              href={`/equipo?atencion=${encodeURIComponent(t)}`}
              scroll={false}
              aria-current={filtro === t ? 'page' : undefined}
              className={chip(filtro === t)}
            >
              {t}
            </Link>
          ))}
          <span className="ml-auto text-[13px] font-bold text-neutral-700">
            {lista.length} {lista.length === 1 ? 'profesional' : 'profesionales'}
          </span>
        </nav>
      )}

      {lista.length === 0 ? (
        <EstadoVista estado="vacio" titulo="Todavía no hay perfiles publicados" mensaje="Vuelve pronto o escríbenos para coordinar una hora." />
      ) : (
        <div className="grid items-stretch gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,330px),1fr))]">
          {lista.map((p) => (
            <TarjetaPerfil key={p.id} perfil={p} agenda={agenda} />
          ))}
        </div>
      )}

      {match && lista.length > 0 && (
        <LlamadoAccion
          titulo="¿No sabes con quién atenderte?"
          texto="Responde unas preguntas sobre lo que te trae al centro y te sugerimos a alguien del equipo, con sus horas disponibles."
          acciones={
            <ButtonLink href="/match" variant="team" size="lg" icon="join">
              Hacer el match terapéutico
            </ButtonLink>
          }
        />
      )}
    </>
  );
}

/** Perfil publico completo: contenido a la izquierda; agenda y reseñas fijas a la derecha. */
export function PaginaPerfil({ perfil, resenas, agenda }: { perfil: PerfilPublico; resenas: ResenaPublica[]; agenda: boolean }) {
  return (
    <div className="entrada pt-[clamp(10px,2vw,24px)]">
      <EnlaceVolver href="/equipo">Todo el equipo</EnlaceVolver>
      <div className="grid items-start gap-[clamp(24px,4vw,48px)] lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-7">
          <CabeceraPerfil perfil={perfil} nivel={1} size={112} />
          <DatosPerfil perfil={perfil} />
          <SeccionesPerfil perfil={perfil} />
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          {agenda && (
            <div className="rounded-lg border border-accent-2-500 bg-accent-2-200 p-6 shadow-md">
              <p className="m-0 mb-1 text-lg font-black tracking-[-0.02em] text-accent-2-900">Agenda con {nombreCorto(perfil)}</p>
              <p className="m-0 mb-4 text-[13.5px] font-semibold text-pretty text-accent-2-900">Mira sus horas libres y reserva sin crear una cuenta.</p>
              <ButtonLink href={`/pedir-hora/${perfil.id}`} variant="team" size="lg" icon="calendar_month" className="w-full">
                Ver horas disponibles
              </ButtonLink>
            </div>
          )}
          <Resenas perfil={perfil} resenas={resenas} />
        </aside>
      </div>
    </div>
  );
}
