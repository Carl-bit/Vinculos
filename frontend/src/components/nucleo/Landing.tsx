import Link from 'next/link';
import type { ReactNode } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { LlamadoAccion } from '@/components/shared/LlamadoAccion';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import type { CentroPublico, PerfilPublico } from '@/lib/api/servidor';
import { formatoClp, formatoTelefono } from '@/lib/formato';
import { iconoO, type Icono } from '@/lib/iconos';
import { nombrePerfil, tarifaDesde } from '@/lib/perfiles';

/*
 * Landing del centro (diseño "Landing"). Contenido editable por ADMIN
 * (configuracion/contenido-publico); cada seccion aparece solo si tiene datos.
 * Server components: sin JS en el cliente.
 */

export function Portada({ centro, perfiles }: { centro: CentroPublico; perfiles: PerfilPublico[] }) {
  const agenda = centro.modulos.includes('AGENDA');
  const tarifas = perfiles.map(tarifaDesde).filter((t): t is number => t !== null);
  return (
    <section className="grid items-center gap-[clamp(32px,5vw,72px)] py-[clamp(40px,6vw,88px)] md:grid-cols-[1.15fr_1fr]">
      <div className="entrada">
        <Eyebrow>{centro.nombre_centro}</Eyebrow>
        <h1 className="m-0 mb-5 text-[clamp(38px,5.2vw,64px)] leading-[0.98] font-black tracking-[-0.035em] text-balance">
          {centro.hero_titulo ?? centro.nombre_centro}
        </h1>
        {centro.hero_texto && <p className="m-0 mb-8 max-w-[48ch] text-[17.5px] leading-relaxed text-pretty text-neutral-700">{centro.hero_texto}</p>}
        <div className="flex flex-wrap gap-3">
          {agenda && (
            <ButtonLink href="/pedir-hora" variant="team" size="lg">
              Pedir una hora
            </ButtonLink>
          )}
          {perfiles.length > 0 && (
            <ButtonLink href="/equipo" variant="secondary" size="lg">
              Conocer al equipo
            </ButtonLink>
          )}
        </div>
      </div>
      <div className="relative mx-auto w-full max-w-[420px]">
        {/* Arco del diseño: con fotos del equipo si las hay; si no, el icono. */}
        <div className="grid aspect-[4/5] place-items-center overflow-hidden rounded-[220px_220px_26px_26px] border border-accent-2-500 bg-accent-2-200 shadow-lg">
          {perfiles.some((p) => p.foto_url) ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen publica de la API (mismo origen).
            <img src={perfiles.find((p) => p.foto_url)!.foto_url!} alt="" className="size-full object-cover object-top saturate-[0.86]" />
          ) : (
            <Icon name="diversity_3" size={74} className="text-accent-2-600" />
          )}
        </div>
        {/* Dato real del equipo publicado (la API no tiene "proxima disponibilidad" del centro). */}
        {perfiles.length > 0 && (
          <div className="absolute -bottom-[18px] left-0 rounded-lg border border-divider bg-neutral-100 px-5 py-[15px] shadow-md sm:-left-[22px]">
            <div className="mb-[5px] text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">Equipo del centro</div>
            <div className="text-base font-black tracking-[-0.02em]">
              {perfiles.length} {perfiles.length === 1 ? 'profesional' : 'profesionales'}
              {tarifas.length > 0 && <span className="font-bold text-neutral-700"> · desde {formatoClp(Math.min(...tarifas))}</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function Servicios({ centro }: { centro: CentroPublico }) {
  if (centro.servicios.length === 0) return null;
  return (
    <section id="servicios" className="scroll-mt-6 py-[clamp(32px,5vw,64px)]">
      <Eyebrow tone="patient">Servicios</Eyebrow>
      <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(250px,1fr))]">
        {centro.servicios.map((s) => (
          <div
            key={s.titulo}
            className="revelar rounded-lg border border-divider bg-neutral-100 p-[26px] shadow-sm transition-shadow duration-200 hover:shadow-lg"
          >
            <Icon name={iconoO(s.icono, 'spa')} size={28} className="mb-3.5 block text-accent-700" />
            <h2 className="m-0 mb-2 text-[19px] font-black tracking-[-0.02em]">{s.titulo}</h2>
            <p className="m-0 text-[14.5px] leading-[1.55] text-pretty text-neutral-700">{s.texto}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Mision y vision, si el centro las publico. */
export function ComoTrabajamos({ centro }: { centro: CentroPublico }) {
  const bloques = [centro.mision && { titulo: 'Misión', texto: centro.mision }, centro.vision && { titulo: 'Visión', texto: centro.vision }].filter(
    (b): b is { titulo: string; texto: string } => !!b,
  );
  if (bloques.length === 0) return null;
  return (
    <section className="grid gap-[18px] py-[clamp(24px,4vw,48px)] md:grid-cols-2">
      {bloques.map((b) => (
        <figure key={b.titulo} className="revelar m-0 border-l-2 border-accent-500 pl-6">
          <figcaption className="mb-2 text-[11px] font-extrabold tracking-[0.16em] text-accent-700 uppercase">{b.titulo}</figcaption>
          <blockquote className="m-0 text-xl leading-snug font-bold tracking-[-0.01em] text-pretty">{b.texto}</blockquote>
        </figure>
      ))}
    </section>
  );
}

export function EquipoDestacado({ perfiles }: { perfiles: PerfilPublico[] }) {
  if (perfiles.length === 0) return null;
  return (
    <section id="equipo" className="py-[clamp(32px,5vw,64px)]">
      <div className="mb-[26px] flex flex-wrap items-end justify-between gap-5">
        <div>
          <Eyebrow>Equipo</Eyebrow>
          <p className="m-0 max-w-[52ch] text-base leading-relaxed text-pretty text-neutral-700">
            Cada ficha pública muestra formación verificada, enfoque y valoraciones de pacientes atendidos. No necesitas cuenta para revisarlas.
          </p>
        </div>
        <ButtonLink href="/equipo" variant="secondary" className="flex-none">
          Conoce a nuestro equipo
        </ButtonLink>
      </div>
      <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
        {perfiles.slice(0, 4).map((p) => (
          <Link key={p.id} href={`/equipo/${p.id}`} className="group revelar flex flex-col gap-[13px] text-text hover:text-text">
            <span className="block rounded-full transition-[box-shadow] duration-300 ease-out group-hover:shadow-lg">
              <AvatarProfesional nombre={nombrePerfil(p)} foto={p.foto_url} size="fluido" />
            </span>
            <span>
              <span className="block text-base font-black tracking-[-0.02em]">{nombrePerfil(p)}</span>
              <span className="block text-[13.5px] font-semibold text-neutral-700">{p.especialidad}</span>
              <span className="mt-[7px] flex items-center gap-1.5 text-[12.5px] font-extrabold text-accent-700">
                Ver su ficha
                <Icon name="arrow_forward" size={15} className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Dato({ icono, children }: { icono: Icono; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <Icon name={icono} size={19} className="text-accent-2-700" />
      {children}
    </span>
  );
}

export function Contacto({ centro, perfiles }: { centro: CentroPublico; perfiles: PerfilPublico[] }) {
  const agenda = centro.modulos.includes('AGENDA');
  const match = centro.modulos.includes('MATCH') && perfiles.length > 0;
  const hayContacto = centro.contacto_correo || centro.contacto_telefono || centro.direccion || centro.whatsapp;
  if (!agenda && !match && !hayContacto) return null;
  return (
    <LlamadoAccion
      id="contacto"
      titulo="¿Quieres reservar una hora?"
      texto={agenda ? 'Elige profesional y horario en línea, sin crear una cuenta antes.' : 'Escríbenos y coordinamos según tu disponibilidad.'}
      acciones={
        <>
          {agenda && (
            <ButtonLink href="/pedir-hora" variant="team" size="lg" icon="calendar_month">
              Pedir una hora en línea
            </ButtonLink>
          )}
          {match && (
            <ButtonLink href="/match" variant="outlinePatient" size="lg" icon="join">
              No sé con quién · hacer el match
            </ButtonLink>
          )}
        </>
      }
      lateral={
        hayContacto && (
          <address className="flex flex-col gap-[7px] text-[15.5px] font-bold not-italic">
            {centro.contacto_correo && (
              <Dato icono="mail">
                <a href={`mailto:${centro.contacto_correo}`} className="text-text hover:text-accent-2-800">
                  {centro.contacto_correo}
                </a>
              </Dato>
            )}
            {centro.contacto_telefono && (
              <Dato icono="call">
                <a href={`tel:${centro.contacto_telefono}`} className="text-text hover:text-accent-2-800">
                  {formatoTelefono(centro.contacto_telefono)}
                </a>
              </Dato>
            )}
            {centro.whatsapp && (
              <Dato icono="chat">
                <a href={`https://wa.me/${centro.whatsapp.replace(/\D/g, '')}`} rel="noopener noreferrer" className="text-text hover:text-accent-2-800">
                  WhatsApp {formatoTelefono(centro.whatsapp)}
                </a>
              </Dato>
            )}
            {centro.direccion && <Dato icono="location_on">{centro.direccion}</Dato>}
          </address>
        )
      }
    />
  );
}
