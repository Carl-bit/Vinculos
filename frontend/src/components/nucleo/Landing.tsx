import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { LlamadoAccion } from '@/components/shared/LlamadoAccion';
import { TapaCuaderno } from '@/components/shared/TapaCuaderno';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import type { CentroPublico, PerfilPublico } from '@/lib/api/servidor';
import { formatoClp, formatoTelefono } from '@/lib/formato';
import { iconoO } from '@/lib/iconos';
import { nombrePerfil, tarifaDesde } from '@/lib/perfiles';
import { esCuaderno } from '@/lib/tema';

/*
 * Landing del centro (diseño "Landing", estilo Moderno de
 * design-reference/Landing: superficies translucidas sobre trama de puntos).
 * Contenido editable por ADMIN (configuracion/contenido-publico); cada seccion
 * aparece solo si tiene datos. Server components: sin JS en el cliente.
 */

/** Rotulo de seccion del diseño: mayusculas en arcilla, sin linea. */
function Rotulo({ children }: { children: ReactNode }) {
  return <span className="text-xs font-extrabold tracking-[0.12em] text-accent-700 uppercase">{children}</span>;
}

/** Posiciones de las tarjetas flotantes del diseño (porcentajes para que no se salgan en movil). */
const FLOTANTES = ['left-[8%] top-[10%]', 'left-[30%] top-[39%]', 'left-[3%] top-[68%]'];

export async function Portada({ centro, perfiles }: { centro: CentroPublico; perfiles: PerfilPublico[] }) {
  const cuaderno = await esCuaderno();
  const agenda = centro.modulos.includes('AGENDA');
  const match = centro.modulos.includes('MATCH') && perfiles.length > 0;
  const tarifas = perfiles.map(tarifaDesde).filter((t): t is number => t !== null);
  return (
    <section className="flex flex-wrap items-center gap-8 pt-[30px] pb-2.5">
      <div className="entrada flex flex-[999_1_480px] flex-col items-start gap-[18px]">
        <Badge tono="positivo" className="!border-transparent !text-xs !tracking-[0.12em]">
          {centro.nombre_centro}
        </Badge>
        <h1 className="m-0 text-[clamp(40px,5.4vw,64px)] leading-none font-black tracking-[-0.02em] text-balance">
          {centro.hero_titulo ?? centro.nombre_centro}
        </h1>
        {centro.hero_texto && <p className="m-0 max-w-[560px] text-lg text-pretty text-neutral-800">{centro.hero_texto}</p>}
        <div className="flex flex-wrap gap-2.5">
          {agenda && (
            <ButtonLink href="/pedir-hora" variant="team" size="lg" className="shadow-lg">
              Pedir una hora
            </ButtonLink>
          )}
          {match ? (
            <ButtonLink href="/match" variant="secondary" size="lg">
              No sé con quién: hacer el match
            </ButtonLink>
          ) : (
            perfiles.length > 0 && (
              <ButtonLink href="/equipo" variant="secondary" size="lg">
                Conocer al equipo
              </ButtonLink>
            )
          )}
        </div>
      </div>
      {perfiles.length > 0 && cuaderno && <NotaEquipo perfiles={perfiles} desde={tarifas.length > 0 ? Math.min(...tarifas) : null} />}
      {/* Bloque oliva con profesionales publicados flotando (datos reales: perfiles validados). */}
      {perfiles.length > 0 && !cuaderno && (
        <div className="relative min-h-[380px] flex-[1_1_380px]">
          <div aria-hidden="true" className="absolute inset-[0_40px_40px_0] rounded-[40px] bg-accent-2-200" />
          {perfiles.slice(0, 3).map((p, i) => (
            <div
              key={p.id}
              className={`translucida absolute flex w-[min(250px,78%)] items-center gap-3 rounded-[22px] px-4 py-3 shadow-flotante ${FLOTANTES[i]}`}
            >
              <AvatarProfesional nombre={nombrePerfil(p)} foto={p.foto_url} size={46} cuadrado />
              <span className="flex min-w-0 flex-col">
                <strong className="truncate text-sm">{nombrePerfil(p)}</strong>
                <span className="truncate text-xs text-neutral-700">{p.especialidad}</span>
              </span>
            </div>
          ))}
          <div className="absolute right-0 bottom-0 rounded-[20px] bg-tinta px-[18px] py-3.5 text-neutral-100">
            <span className="block text-[11px] font-extrabold tracking-[0.1em] text-neutral-400 uppercase">Equipo</span>
            <strong className="text-base">
              {perfiles.length} {perfiles.length === 1 ? 'profesional' : 'profesionales'}
              {tarifas.length > 0 && <> · desde {formatoClp(Math.min(...tarifas))}</>}
            </strong>
          </div>
        </div>
      )}
    </section>
  );
}

/** Tema Cuaderno: el resumen del equipo es un post-it escrito a mano (mismos datos que el bloque tinta de Moderno). */
function NotaEquipo({ perfiles, desde }: { perfiles: PerfilPublico[]; desde: number | null }) {
  const modalidades = new Set(perfiles.map((p) => p.modalidad));
  const ambas = modalidades.has('MIXTA') || (modalidades.has('PRESENCIAL') && modalidades.has('ONLINE'));
  return (
    <div className="relative flex min-h-[340px] flex-[1_1_340px] items-start justify-center">
      <div className="nota flex w-[min(280px,90%)] flex-col gap-1.5 px-6 pt-8 pb-6 font-manuscrita text-2xl">
        <span className="text-[30px] leading-tight font-bold">Nuestro equipo</span>
        <span>
          {perfiles.length} {perfiles.length === 1 ? 'profesional' : 'profesionales'}
        </span>
        {desde !== null && <span>desde {formatoClp(desde)}</span>}
        {ambas && <span>presencial y online</span>}
        <span className="mt-3 text-[22px] text-[var(--color-ladrillo)]">sin crear cuenta para reservar</span>
      </div>
    </div>
  );
}

export function Servicios({ centro }: { centro: CentroPublico }) {
  if (centro.servicios.length === 0) return null;
  return (
    <section id="servicios" className="flex scroll-mt-24 flex-col gap-3.5 pt-[clamp(28px,4vw,48px)]">
      <Rotulo>Servicios</Rotulo>
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(250px,1fr))]">
        {centro.servicios.map((s) => (
          <article key={s.titulo} className="nota revelar flex flex-col gap-2.5 rounded-panel bg-bg p-6 shadow-suave">
            {/* Icono elegido por el centro, sin tile (regla del proyecto: nada de icono en cuadrado sobre cada titulo). */}
            <Icon name={iconoO(s.icono, 'spa')} size={28} className="text-accent-700" />
            <h2 className="m-0 text-[21px] font-black tracking-[-0.01em]">{s.titulo}</h2>
            <p className="m-0 text-sm text-pretty text-neutral-800">{s.texto}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Mision y vision, si el centro las publico (no esta en el diseño: se conserva, contenido del ADMIN). */
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

export async function EquipoDestacado({ perfiles }: { perfiles: PerfilPublico[] }) {
  if (perfiles.length === 0) return null;
  const cuaderno = await esCuaderno();
  return (
    <section id="equipo" className="flex flex-col gap-3.5 pt-[clamp(28px,4vw,48px)]">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Rotulo>Equipo</Rotulo>
          {/* Verdadero por regla: el sitio solo publica perfiles validados por la cuenta madre. */}
          <h2 className="m-0 text-[clamp(26px,3vw,32px)] leading-tight font-black tracking-[-0.02em]">Formación verificada por el centro</h2>
        </div>
        <ButtonLink href="/equipo" variant="secondary" className="ml-auto flex-none">
          Conoce a todo el equipo
        </ButtonLink>
      </div>
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {perfiles.slice(0, 4).map((p, i) =>
          cuaderno ? (
            <Link key={p.id} href={`/equipo/${p.id}`} className="revelar block text-tinta hover:text-tinta">
              <TapaCuaderno orden={i} nombre={nombrePerfil(p)} especialidad={p.especialidad} />
            </Link>
          ) : (
            <Link
              key={p.id}
              href={`/equipo/${p.id}`}
              className="revelar flex flex-col gap-2.5 rounded-panel bg-bg p-4 text-text shadow-suave transition-shadow duration-200 ease-out hover:text-text hover:shadow-flotante"
            >
              <AvatarProfesional nombre={nombrePerfil(p)} foto={p.foto_url} size="fluido" cuadrado />
              <span className="flex flex-col">
                <strong className="text-[15px]">{nombrePerfil(p)}</strong>
                <span className="text-[13px] text-neutral-700">{p.especialidad}</span>
              </span>
            </Link>
          ),
        )}
      </div>
    </section>
  );
}

/** Correo, telefono, WhatsApp y direccion en una linea (separados por punto medio). */
function LineaContacto({ centro }: { centro: CentroPublico }) {
  const enlace = 'text-neutral-300 underline-offset-2 hover:text-neutral-100 hover:underline';
  const datos = [
    centro.contacto_correo && (
      <a key="correo" href={`mailto:${centro.contacto_correo}`} className={enlace}>
        {centro.contacto_correo}
      </a>
    ),
    centro.contacto_telefono && (
      <a key="tel" href={`tel:${centro.contacto_telefono}`} className={enlace}>
        {formatoTelefono(centro.contacto_telefono)}
      </a>
    ),
    centro.whatsapp && (
      <a key="wa" href={`https://wa.me/${centro.whatsapp.replace(/\D/g, '')}`} rel="noopener noreferrer" className={enlace}>
        WhatsApp {formatoTelefono(centro.whatsapp)}
      </a>
    ),
    centro.direccion && <span key="dir">{centro.direccion}</span>,
  ].filter(Boolean);
  if (datos.length === 0) return null;
  return (
    <span className="mt-2 block text-[13px] font-medium text-neutral-400">
      {datos.map((d, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          {d}
        </Fragment>
      ))}
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
      tono="oscuro"
      titulo={agenda ? '¿Quieres reservar una hora?' : 'Conversemos'}
      texto={
        <>
          {agenda ? 'Elige profesional y horario en línea, sin crear una cuenta antes.' : 'Escríbenos y coordinamos según tu disponibilidad.'}
          <LineaContacto centro={centro} />
        </>
      }
      lateral={
        (agenda || match) && (
          <div className="flex flex-wrap gap-2.5">
            {agenda && (
              <ButtonLink href="/pedir-hora" variant="sobreOscuro" size="lg">
                Pedir una hora en línea
              </ButtonLink>
            )}
            {match && (
              <ButtonLink href="/match" variant="contornoOscuro" size="lg">
                Hacer el match
              </ButtonLink>
            )}
          </div>
        )
      }
    />
  );
}
