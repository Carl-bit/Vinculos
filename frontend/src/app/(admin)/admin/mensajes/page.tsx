'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { MensajeriaInterna } from '@/components/equipo/MensajeriaInterna';
import { BandejaAvisos } from '@/components/nucleo/BandejaAvisos';
import { MensajesPacientes } from '@/components/pacientes/MensajesPacientes';
import { Encabezado } from '@/components/shared/Encabezado';
import { Pestanas } from '@/components/ui/Pestanas';
import { useSesion } from '@/lib/consultas';

type Vista = 'equipo' | 'pacientes' | 'avisos';

/** Mensajes: conversaciones del equipo, mensajes de pacientes (solo quien atiende) y la bandeja de avisos. */
function Mensajes() {
  const sesion = useSesion();
  const router = useRouter();
  const parametros = useSearchParams();
  if (sesion.tipo !== 'activa') return null;
  const rol = sesion.sesion.rol;
  const clinico = rol === 'PROFESIONAL' || rol === 'PRACTICANTE';
  const opciones: { valor: Vista; etiqueta: string }[] = [
    { valor: 'equipo', etiqueta: 'Equipo' },
    ...(clinico ? [{ valor: 'pacientes' as const, etiqueta: 'De pacientes' }] : []),
    { valor: 'avisos', etiqueta: 'Avisos' },
  ];
  const vista = opciones.find((o) => o.valor === parametros.get('vista'))?.valor ?? 'equipo';
  return (
    <>
      <Encabezado tono="team" titulo="Mensajes" bajada="Coordinación del equipo, mensajes de tus pacientes y avisos del centro." />
      <div className="flex flex-col gap-4">
        <Pestanas
          etiqueta="Bandejas"
          tono="team"
          valor={vista}
          onChange={(v) => router.replace(v === 'equipo' ? '/admin/mensajes' : `/admin/mensajes?vista=${v}`, { scroll: false })}
          pestanas={opciones}
        />
        {vista === 'equipo' && (
          <MensajeriaInterna rol={rol} hiloInicial={parametros.get('hilo') ?? undefined} nuevoCaso={parametros.get('caso') ?? undefined} />
        )}
        {vista === 'pacientes' && <MensajesPacientes />}
        {vista === 'avisos' && <BandejaAvisos />}
      </div>
    </>
  );
}

export default function Pagina() {
  return (
    <Suspense>
      <Mensajes />
    </Suspense>
  );
}
