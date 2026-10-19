import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import type { PerfilPublico, ResenaPublica } from '@/lib/api/servidor';
import { formatoClp, formatoFechaLarga } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { NOMBRE_MODALIDAD, NOMBRE_TRAYECTORIA, previsionTexto, textoCalificacion } from '@/lib/perfiles';

import { ReportarResena } from './ReportarResena';

/*
 * Perfil publico completo (no esta en el diseño: se arma con las secciones del
 * detalle de "Match Publico"). Cada seccion aparece solo si tiene datos.
 * Genero: 03a no lo implemento, no se muestra.
 */

function Seccion({ icono, titulo, children }: { icono: Icono; titulo: string; children: ReactNode }) {
  return (
    <section className="revelar">
      <h2 className="m-0 mb-3 flex items-center gap-[9px] text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">
        <Icon name={icono} className="text-accent-2-700" />
        {titulo}
      </h2>
      {children}
    </section>
  );
}

const Etiquetas = ({ items }: { items: string[] }) => (
  <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
    {items.map((t) => (
      <li key={t} className="rounded-full border border-accent-2-500 bg-accent-2-100 px-3.5 py-[7px] text-[12.5px] font-extrabold text-accent-2-900">
        {t}
      </li>
    ))}
  </ul>
);

export function SeccionesPerfil({ perfil }: { perfil: PerfilPublico }) {
  const prevision = previsionTexto(perfil);
  const tarifas = [...perfil.tarifas].sort((a, b) => a.monto - b.monto);
  return (
    <div className="flex flex-col gap-7">
      {perfil.cita_destacada && (
        <figure className="revelar m-0 rounded-lg border border-accent-500 bg-accent-100 px-6 py-5">
          <Icon name="format_quote" size={26} className="text-accent-700" />
          <blockquote className="m-0 mt-1 text-lg leading-snug font-bold tracking-[-0.01em] text-pretty text-accent-900">{perfil.cita_destacada}</blockquote>
        </figure>
      )}
      {perfil.bio && (
        <Seccion icono="person" titulo="Sobre mí">
          <p className="m-0 text-[15px] leading-[1.7] font-medium text-pretty whitespace-pre-line text-neutral-800">{perfil.bio}</p>
        </Seccion>
      )}
      {perfil.trayectoria.length > 0 && (
        <Seccion icono="school" titulo="Formación verificada">
          <ul className="m-0 flex list-none flex-col gap-[9px] p-0">
            {perfil.trayectoria.map((t) => (
              <li key={`${t.titulo}-${t.anio}`} className="flex gap-[11px] rounded-[16px] border border-divider bg-neutral-100 px-4 py-[13px]">
                <Icon name={t.tipo === 'OTRO' ? 'badge' : 'workspace_premium'} size={17} className="text-accent-2-700" />
                <span className="min-w-0">
                  <span className="block text-sm font-extrabold tracking-[-0.015em]">{t.titulo}</span>
                  <span className="mt-0.5 block text-[12.5px] font-semibold text-neutral-700">
                    {NOMBRE_TRAYECTORIA[t.tipo] ?? t.tipo} · {t.institucion} · {t.anio}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700">
            <Icon name="verified_user" size={15} />
            El centro revisó los respaldos de estos títulos.
          </p>
        </Seccion>
      )}
      {(perfil.enfoques.length > 0 || perfil.tipos_atencion.length > 0) && (
        <Seccion icono="verified" titulo="Especialidades y atención">
          <Etiquetas items={[...perfil.tipos_atencion, ...perfil.enfoques]} />
        </Seccion>
      )}
      {perfil.idiomas.length > 0 && (
        <Seccion icono="translate" titulo="Idiomas">
          <Etiquetas items={perfil.idiomas} />
        </Seccion>
      )}
      <Seccion icono="payments" titulo="Modalidad y tarifas">
        <p className="m-0 mb-2.5 text-[14.5px] font-bold">{NOMBRE_MODALIDAD[perfil.modalidad]}</p>
        {tarifas.length > 0 && (
          <dl className="m-0 grid gap-x-6 gap-y-1.5 text-[14px] [grid-template-columns:auto_auto] sm:max-w-md">
            {tarifas.map((t) => (
              <div key={`${t.tipo_atencion}-${t.modalidad}`} className="contents">
                <dt className="font-semibold text-neutral-700">
                  {t.tipo_atencion ?? 'Sesión'}
                  {t.modalidad ? ` · ${t.modalidad === 'ONLINE' ? 'online' : 'presencial'}` : ''}
                </dt>
                <dd className="m-0 text-right font-extrabold">{formatoClp(t.monto)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Seccion>
      {prevision.length > 0 && (
        <Seccion icono="receipt_long" titulo="Previsión y convenios">
          <Etiquetas items={prevision} />
        </Seccion>
      )}
    </div>
  );
}

const estrellas = (n: number) => (
  <span className="inline-flex text-accent-700" role="img" aria-label={`${n} de 5`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Icon key={i} name="star" size={15} className={i <= n ? "[font-variation-settings:'FILL'_1]" : 'text-neutral-400'} />
    ))}
  </span>
);

/** Reseñas publicadas (D-1): promedio, cantidad, autor "Nombre + inicial" o anonimo. */
export function Resenas({ perfil, resenas }: { perfil: PerfilPublico; resenas: ResenaPublica[] }) {
  const nota = textoCalificacion(perfil);
  return (
    <section aria-labelledby="titulo-resenas" className="revelar rounded-lg border border-divider bg-neutral-100 p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="titulo-resenas" className="m-0 flex items-center gap-2 text-lg font-black tracking-[-0.02em]">
          <Icon name="reviews" className="text-accent-2-700" />
          Valoraciones
        </h2>
        {nota && (
          <span className="text-sm font-bold text-neutral-700">
            <span className="text-[26px] font-black tracking-[-0.03em] text-text">{nota}</span> de 5 · {perfil.resenas}{' '}
            {perfil.resenas === 1 ? 'valoración' : 'valoraciones'}
          </span>
        )}
      </div>
      <p className="m-0 mb-4 flex items-start gap-2 text-[12.5px] font-semibold text-pretty text-neutral-700">
        <Icon name="info" size={16} />
        Solo pueden valorar pacientes que tuvieron al menos una sesión con este profesional. El centro revisa cada valoración antes de publicarla.
      </p>
      {resenas.length === 0 ? (
        <p className="m-0 text-sm font-bold text-neutral-700">Todavía no hay valoraciones publicadas.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-divider p-0">
          {resenas.map((r) => (
            <li key={r.id} className="py-3.5 first:pt-0 last:pb-0">
              <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {estrellas(r.calificacion)}
                <span className="text-[13px] font-extrabold">{r.autor}</span>
                <time dateTime={new Date(r.fecha).toISOString()} className="text-[12px] font-semibold text-neutral-700">
                  {formatoFechaLarga(r.fecha)}
                </time>
              </div>
              {r.texto && <p className="m-0 text-[14px] leading-relaxed text-pretty text-neutral-800">{r.texto}</p>}
              <ReportarResena resenaId={r.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
