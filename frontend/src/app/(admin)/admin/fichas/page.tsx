'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { SupervisionCasos } from '@/components/equipo/SupervisionCasos';
import { AccesosTemporalesVista } from '@/components/pacientes/AccesosTemporales';
import { CatalogosClinicos } from '@/components/pacientes/CatalogosClinicos';
import { ConsentimientosEquipo } from '@/components/pacientes/ConsentimientosEquipo';
import { DerivacionesVista } from '@/components/pacientes/Derivaciones';
import { FichasProfesional } from '@/components/pacientes/FichasProfesional';
import { ListaPacientes } from '@/components/pacientes/ListaPacientes';
import { NuevoPaciente } from '@/components/pacientes/NuevoPaciente';
import { PlantillasClinicas } from '@/components/pacientes/PlantillasClinicas';
import { RetencionFichas } from '@/components/pacientes/RetencionFichas';
import { SeguimientoEquipo } from '@/components/pacientes/SeguimientoEquipo';
import { Encabezado } from '@/components/shared/Encabezado';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ControlSegmentado } from '@/components/ui/ControlSegmentado';
import { Icon } from '@/components/ui/Icon';
import { Pestanas } from '@/components/ui/Pestanas';
import { useMiCuenta, useSesion } from '@/lib/consultas';
import { accesoVigente, useAccesosRecibidos, useDerivacionesLista } from '@/lib/derivaciones';
import { useSupervisiones } from '@/lib/equipo';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

type Vista = 'equipo' | 'pacientes' | 'derivaciones' | 'accesos' | 'practicas' | 'supervision' | 'configuracion';
type Config = 'plantillas' | 'catalogos' | 'retencion';

/** Enlaces anteriores: consentimientos de practicante = Practicas; borradores viven en "Por hacer". */
const ALIAS: Record<string, Vista> = {
  consentimientos: 'practicas',
  borradores: 'pacientes',
  plantillas: 'configuracion',
  catalogos: 'configuracion',
  retencion: 'configuracion',
};

/**
 * Secciones del modulo por rol: GESTION no ve nada clinico (configuracion
 * clinica, derivaciones ni accesos). Practicas (consentimientos de
 * practicante y avisos de cambio de supervisor): administracion y quien
 * supervisa. Supervision de casos: quien supervisa.
 */
function secciones(rol: Rol, supervisa: boolean, n: { derivaciones: number; accesos: number; practicas: number }): { valor: Vista; etiqueta: string }[] {
  const con = (texto: string, k: number) => (k ? `${texto} (${k})` : texto);
  if (rol === 'ADMIN')
    return [
      { valor: 'equipo', etiqueta: 'Seguimiento' },
      { valor: 'pacientes', etiqueta: 'Pacientes' },
      { valor: 'derivaciones', etiqueta: con('Derivaciones', n.derivaciones) },
      { valor: 'accesos', etiqueta: con('Accesos temporales', n.accesos) },
      { valor: 'practicas', etiqueta: con('Prácticas', n.practicas) },
      { valor: 'configuracion', etiqueta: 'Configuración clínica' },
    ];
  if (rol === 'GESTION')
    return [
      { valor: 'equipo', etiqueta: 'Seguimiento' },
      { valor: 'pacientes', etiqueta: 'Pacientes' },
      { valor: 'practicas', etiqueta: con('Prácticas', n.practicas) },
    ];
  return [
    { valor: 'pacientes', etiqueta: 'Mis pacientes' },
    { valor: 'derivaciones', etiqueta: rol === 'PRACTICANTE' ? 'Ofertas de derivación' : 'Derivaciones' },
    ...(rol === 'PROFESIONAL' ? [{ valor: 'accesos' as const, etiqueta: 'Accesos temporales' }] : []),
    ...(supervisa
      ? [
          { valor: 'practicas' as const, etiqueta: 'Prácticas' },
          { valor: 'supervision' as const, etiqueta: 'Supervisión' },
        ]
      : []),
    { valor: 'configuracion', etiqueta: 'Plantillas y catálogos' },
  ];
}

/**
 * Fichas y Pacientes. ADMIN/GESTION: seguimiento del trabajo de cada
 * profesional (pacientes solo por codigo de ficha), lista de pacientes y las
 * bandejas del centro. Profesional y practicante: riel "Mis pacientes" con la
 * ficha completa al lado.
 */
function Fichas() {
  const sesion = useSesion();
  const router = useRouter();
  const parametros = useSearchParams();
  const cuenta = useMiCuenta();
  const supervisiones = useSupervisiones();
  const rol = sesion.tipo === 'activa' ? sesion.sesion.rol : null;
  const derivaciones = useDerivacionesLista(undefined, rol === 'ADMIN');
  const accesos = useAccesosRecibidos(rol === 'ADMIN');
  if (!rol) return null;
  const admin = esAdministracion(rol);
  const supervisa = rol === 'PROFESIONAL' && (supervisiones.data ?? []).some((s) => s.supervisorId === cuenta.data?.id && !s.hasta);
  const opciones = secciones(rol, supervisa, {
    derivaciones: (derivaciones.data ?? []).filter((d) => ['PENDIENTE', 'ESPERANDO_CONSENTIMIENTO', 'SIN_ASIGNAR'].includes(d.estado)).length,
    accesos: (accesos.data ?? []).filter((a) => accesoVigente(a)).length,
    practicas: (supervisiones.data ?? []).filter((s) => !s.hasta).length,
  });
  const crudo = parametros.get('filtro') ? 'pacientes' : (parametros.get('vista') ?? '');
  const pedida = ALIAS[crudo] ?? crudo;
  const vista = opciones.find((o) => o.valor === pedida)?.valor ?? opciones[0]!.valor;
  const configs: { valor: Config; etiqueta: string }[] = [
    { valor: 'plantillas', etiqueta: 'Plantillas' },
    { valor: 'catalogos', etiqueta: 'Catálogos' },
    ...(rol === 'ADMIN' ? [{ valor: 'retencion' as const, etiqueta: 'Retención' }] : []),
  ];
  const config = configs.find((c) => c.valor === crudo)?.valor ?? 'plantillas';
  const ir = (v: string) => router.replace(v === opciones[0]!.valor ? '/admin/fichas' : `/admin/fichas?vista=${v}`, { scroll: false });
  const pestanas = <Pestanas etiqueta="Secciones" tono="team" valor={vista} onChange={(v) => ir(v === 'configuracion' ? config : v)} pestanas={opciones} />;

  // Profesional y practicante en "Mis pacientes": el riel lleva el titulo y la ficha ocupa el resto.
  if (!admin && vista === 'pacientes') {
    return (
      <div className="flex flex-col gap-2 pt-[clamp(12px,2vw,20px)]">
        {pestanas}
        <FichasProfesional rol={rol} />
      </div>
    );
  }

  return (
    <>
      <Encabezado
        tono="team"
        titulo={admin ? 'Equipo y seguimiento' : 'Fichas y pacientes'}
        bajada={
          admin ? 'Cómo avanza el trabajo de cada profesional. Las fichas solo las abre su tratante.' : 'Derivaciones, accesos y plantillas de tus fichas.'
        }
        accion={
          <div className="flex flex-wrap items-center gap-2.5">
            {admin && vista === 'equipo' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-text px-3 py-1.5 text-[12px] font-bold text-neutral-100">
                <Icon name="lock" size={15} />
                Pacientes identificados solo por código de ficha
              </span>
            )}
            {rol !== 'PRACTICANTE' && <NuevoPaciente rol={rol} variante="team" />}
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        {pestanas}
        {vista === 'equipo' && (
          <SeguimientoEquipo
            rol={rol}
            agregarProfesional={
              rol === 'ADMIN' ? (
                <ButtonLink href="/admin/equipo?nuevo=1" variant="ghost" icon="person_add" className="!py-2 !text-[13px]">
                  Agregar profesional
                </ButtonLink>
              ) : undefined
            }
          />
        )}
        {vista === 'pacientes' && <ListaPacientes rol={rol} />}
        {vista === 'derivaciones' && <DerivacionesVista rol={rol} />}
        {vista === 'accesos' && <AccesosTemporalesVista rol={rol} />}
        {vista === 'practicas' && <ConsentimientosEquipo rol={rol} />}
        {vista === 'supervision' && <SupervisionCasos />}
        {vista === 'configuracion' && (
          <>
            <ControlSegmentado etiqueta="Configuración clínica" tono="team" opciones={configs} valor={config} onChange={(c) => ir(c)} className="self-start" />
            {config === 'plantillas' && <PlantillasClinicas rol={rol} />}
            {config === 'catalogos' && <CatalogosClinicos rol={rol} />}
            {config === 'retencion' && <RetencionFichas />}
          </>
        )}
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
