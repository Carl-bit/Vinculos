'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { AccesosTemporalesVista } from '@/components/pacientes/AccesosTemporales';
import { BorradoresPendientes } from '@/components/pacientes/BorradoresPendientes';
import { CatalogosClinicos } from '@/components/pacientes/CatalogosClinicos';
import { ConsentimientosEquipo } from '@/components/pacientes/ConsentimientosEquipo';
import { DerivacionesVista } from '@/components/pacientes/Derivaciones';
import { ListaPacientes } from '@/components/pacientes/ListaPacientes';
import { NuevoPaciente } from '@/components/pacientes/NuevoPaciente';
import { PlantillasClinicas } from '@/components/pacientes/PlantillasClinicas';
import { RetencionFichas } from '@/components/pacientes/RetencionFichas';
import { VistaAdministrativa } from '@/components/pacientes/VistaAdministrativa';
import { Encabezado } from '@/components/shared/Encabezado';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Pestanas } from '@/components/ui/Pestanas';
import { useMiCuenta, useSesion } from '@/lib/consultas';
import { useSupervisiones } from '@/lib/equipo';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

type Vista = 'equipo' | 'pacientes' | 'borradores' | 'derivaciones' | 'accesos' | 'consentimientos' | 'plantillas' | 'catalogos' | 'retencion';

/**
 * Secciones del modulo por rol: GESTION no ve nada clinico (plantillas,
 * catalogos, retencion, derivaciones ni accesos). Consentimientos de
 * practicante: administracion y quien supervisa.
 */
function secciones(rol: Rol, supervisa: boolean): { valor: Vista; etiqueta: string }[] {
  if (rol === 'ADMIN')
    return [
      { valor: 'equipo', etiqueta: 'Por profesional' },
      { valor: 'pacientes', etiqueta: 'Todos los pacientes' },
      { valor: 'derivaciones', etiqueta: 'Derivaciones' },
      { valor: 'accesos', etiqueta: 'Accesos temporales' },
      { valor: 'consentimientos', etiqueta: 'Consentimientos' },
      { valor: 'plantillas', etiqueta: 'Plantillas clínicas' },
      { valor: 'catalogos', etiqueta: 'Catálogos clínicos' },
      { valor: 'retencion', etiqueta: 'Retención' },
    ];
  if (rol === 'GESTION')
    return [
      { valor: 'equipo', etiqueta: 'Por profesional' },
      { valor: 'pacientes', etiqueta: 'Todos los pacientes' },
      { valor: 'consentimientos', etiqueta: 'Consentimientos' },
    ];
  return [
    { valor: 'pacientes', etiqueta: 'Mis pacientes' },
    { valor: 'borradores', etiqueta: 'Borradores' },
    { valor: 'derivaciones', etiqueta: rol === 'PRACTICANTE' ? 'Ofertas de derivación' : 'Derivaciones' },
    ...(rol === 'PROFESIONAL' ? [{ valor: 'accesos' as const, etiqueta: 'Accesos temporales' }] : []),
    ...(supervisa ? [{ valor: 'consentimientos' as const, etiqueta: 'Consentimientos' }] : []),
    { valor: 'plantillas', etiqueta: 'Plantillas clínicas' },
    { valor: 'catalogos', etiqueta: 'Catálogos clínicos' },
  ];
}

/** Fichas y Pacientes: el profesional ve su lista; ADMIN/GESTION, la vista administrativa o todos los pacientes. */
function Fichas() {
  const sesion = useSesion();
  const router = useRouter();
  const parametros = useSearchParams();
  const cuenta = useMiCuenta();
  const supervisiones = useSupervisiones();
  if (sesion.tipo !== 'activa') return null;
  const rol = sesion.sesion.rol;
  const admin = esAdministracion(rol);
  const supervisa = rol === 'PROFESIONAL' && (supervisiones.data ?? []).some((s) => s.supervisorId === cuenta.data?.id && !s.hasta);
  const opciones = secciones(rol, supervisa);
  const pedida = parametros.get('filtro') ? 'pacientes' : parametros.get('vista');
  const vista = opciones.find((o) => o.valor === pedida)?.valor ?? opciones[0].valor;
  const ir = (v: Vista) => router.replace(v === opciones[0].valor ? '/admin/fichas' : `/admin/fichas?vista=${v}`, { scroll: false });
  return (
    <>
      <Encabezado
        tono="team"
        titulo={admin ? 'Pacientes y equipo' : 'Pacientes'}
        bajada={admin ? 'Asignación y estado administrativo, sin contenido clínico.' : 'Tus pacientes, sus horas y el estado de cada ficha.'}
        accion={rol !== 'PRACTICANTE' ? <NuevoPaciente rol={rol} variante="team" /> : undefined}
      />
      <div className="flex flex-col gap-4">
        <Pestanas etiqueta="Secciones" tono="team" valor={vista} onChange={ir} pestanas={opciones} />
        {vista === 'equipo' && (
          <VistaAdministrativa
            agregarProfesional={
              rol === 'ADMIN' ? (
                <ButtonLink href="/admin/equipo?nuevo=1" variant="secondary" icon="person_add" className="!py-2.5">
                  Nueva cuenta
                </ButtonLink>
              ) : undefined
            }
          />
        )}
        {vista === 'pacientes' && <ListaPacientes rol={rol} />}
        {vista === 'borradores' && <BorradoresPendientes />}
        {vista === 'derivaciones' && <DerivacionesVista rol={rol} />}
        {vista === 'accesos' && <AccesosTemporalesVista rol={rol} />}
        {vista === 'consentimientos' && <ConsentimientosEquipo rol={rol} />}
        {vista === 'plantillas' && <PlantillasClinicas rol={rol} />}
        {vista === 'catalogos' && <CatalogosClinicos rol={rol} />}
        {vista === 'retencion' && <RetencionFichas />}
      </div>
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
