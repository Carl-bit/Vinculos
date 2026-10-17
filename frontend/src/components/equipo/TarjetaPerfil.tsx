import type { ReactNode } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import type { PerfilPublico } from '@/lib/api/servidor';
import type { Icono } from '@/lib/iconos';
import { formacionBase, NOMBRE_MODALIDAD, nombreCorto, nombrePerfil, textoCalificacion, textoTarifa } from '@/lib/perfiles';

/** Pastilla de dato (precio, modalidad, experiencia) del diseño "Equipo Publico". */
export function Dato({ icono, children }: { icono: Icono; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[7px] rounded-full border border-divider bg-bg px-3.5 py-[7px] text-[12.5px] font-extrabold">
      <Icon name={icono} size={16} className="text-accent-2-700" />
      {children}
    </span>
  );
}

export function Calificacion({ perfil }: { perfil: PerfilPublico }) {
  const nota = textoCalificacion(perfil);
  if (!nota) return <span className="text-[12.5px] font-bold text-neutral-700">Sin valoraciones aún</span>;
  return (
    <span className="inline-flex items-center gap-[5px] text-[12.5px] font-extrabold text-accent-700">
      <Icon name="star" size={16} className="[font-variation-settings:'FILL'_1]" />
      {nota}
      <span className="font-semibold text-neutral-700">
        ({perfil.resenas} {perfil.resenas === 1 ? 'valoración' : 'valoraciones'})
      </span>
    </span>
  );
}

export function DatosPerfil({ perfil }: { perfil: PerfilPublico }) {
  const tarifa = textoTarifa(perfil);
  return (
    <div className="flex flex-wrap gap-[7px]">
      {tarifa && <Dato icono="payments">{tarifa}</Dato>}
      <Dato icono={perfil.modalidad === 'PRESENCIAL' ? 'meeting_room' : 'videocam'}>{NOMBRE_MODALIDAD[perfil.modalidad]}</Dato>
      {perfil.anios_experiencia !== null && perfil.anios_experiencia > 0 && (
        <Dato icono="history">
          {perfil.anios_experiencia} {perfil.anios_experiencia === 1 ? 'año' : 'años'} de experiencia
        </Dato>
      )}
    </div>
  );
}

/** Cabecera comun: foto, nombre, especialidad, formacion base y valoracion. */
export function CabeceraPerfil({ perfil, nivel = 2, size = 88 }: { perfil: PerfilPublico; nivel?: 1 | 2; size?: number }) {
  const Titulo = nivel === 1 ? 'h1' : 'h2';
  const base = formacionBase(perfil);
  return (
    <div className="flex items-start gap-[17px]">
      <AvatarProfesional nombre={nombrePerfil(perfil)} foto={perfil.foto_url} size={size} />
      <div className="min-w-0 flex-1">
        <Titulo
          className={`m-0 mb-1.5 leading-[1.08] font-black tracking-[-0.03em] text-balance ${nivel === 1 ? 'text-[clamp(30px,4vw,44px)]' : 'text-[21px]'}`}
        >
          {nombrePerfil(perfil)}
        </Titulo>
        <p className="m-0 mb-1 text-[13.5px] font-bold text-pretty text-neutral-700">{perfil.especialidad}</p>
        {base && (
          <p className="m-0 mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700">
            <Icon name="verified" size={15} className="text-accent-2-700" label="Formación verificada por el centro" />
            {base}
          </p>
        )}
        <Calificacion perfil={perfil} />
      </div>
    </div>
  );
}

/** Tarjeta del equipo publico: datos clave, bajada y acciones. */
export function TarjetaPerfil({ perfil, agenda }: { perfil: PerfilPublico; agenda: boolean }) {
  return (
    <article className="revelar flex flex-col gap-4 rounded-lg border border-divider bg-neutral-100 p-6 shadow-sm transition-shadow duration-300 ease-out hover:shadow-lg">
      <CabeceraPerfil perfil={perfil} />
      <DatosPerfil perfil={perfil} />
      {(perfil.cita_destacada ?? perfil.bio) && (
        <p className="m-0 line-clamp-4 text-[14.5px] leading-[1.65] font-medium text-pretty text-neutral-800">{perfil.cita_destacada ?? perfil.bio}</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2.5">
        {agenda && (
          <ButtonLink href={`/pedir-hora/${perfil.id}`} variant="team" icon="calendar_month" className="min-h-11 flex-auto">
            Pedir hora con {nombreCorto(perfil)}
          </ButtonLink>
        )}
        <ButtonLink href={`/equipo/${perfil.id}`} variant="secondary" icon="arrow_forward" className="min-h-11 flex-none whitespace-nowrap">
          Ver perfil completo
          <span className="sr-only"> de {nombrePerfil(perfil)}</span>
        </ButtonLink>
      </div>
    </article>
  );
}
