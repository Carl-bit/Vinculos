'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { ListaPacientes } from '@/components/pacientes/ListaPacientes';
import { NuevoPaciente } from '@/components/pacientes/NuevoPaciente';
import { VistaAdministrativa } from '@/components/pacientes/VistaAdministrativa';
import { Encabezado } from '@/components/shared/Encabezado';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Pestanas } from '@/components/ui/Pestanas';
import { useSesion } from '@/lib/consultas';
import { esAdministracion } from '@/lib/roles';

/** Fichas y Pacientes: el profesional ve su lista; ADMIN/GESTION, la vista administrativa o todos los pacientes. */
function Fichas() {
  const sesion = useSesion();
  const router = useRouter();
  const parametros = useSearchParams();
  const vista = parametros.get('vista') === 'pacientes' || parametros.get('filtro') ? 'pacientes' : 'equipo';
  if (sesion.tipo !== 'activa') return null;
  const rol = sesion.sesion.rol;
  const admin = esAdministracion(rol);
  return (
    <>
      <Encabezado
        tono="team"
        titulo={admin ? 'Pacientes y equipo' : 'Pacientes'}
        bajada={admin ? 'Asignación y estado administrativo, sin contenido clínico.' : 'Tus pacientes, sus horas y el estado de cada ficha.'}
        accion={rol !== 'PRACTICANTE' ? <NuevoPaciente rol={rol} variante="team" /> : undefined}
      />
      {admin ? (
        <div className="flex flex-col gap-4">
          <Pestanas
            etiqueta="Vista"
            tono="team"
            valor={vista}
            onChange={(v) => router.replace(v === 'pacientes' ? '/admin/fichas?vista=pacientes' : '/admin/fichas', { scroll: false })}
            pestanas={[
              { valor: 'equipo', etiqueta: 'Por profesional' },
              { valor: 'pacientes', etiqueta: 'Todos los pacientes' },
            ]}
          />
          {vista === 'equipo' ? (
            <VistaAdministrativa
              agregarProfesional={
                rol === 'ADMIN' ? (
                  <ButtonLink href="/admin/equipo?nuevo=1" variant="secondary" icon="person_add" className="!py-2.5">
                    Nueva cuenta
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <ListaPacientes rol={rol} />
          )}
        </div>
      ) : (
        <ListaPacientes rol={rol} />
      )}
    </>
  );
}

export default function Pagina() {
  return (
    <Suspense>
      <Fichas />
    </Suspense>
  );
}
