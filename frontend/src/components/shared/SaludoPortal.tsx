'use client';

import { Aviso } from '@/components/ui/Aviso';
import { useMiCuenta } from '@/lib/consultas';
import { usePortal } from './ContextoPortal';
import { Encabezado } from './Encabezado';

/** Encabezado de "Mi cuenta" (diseño): saludo con el nombre y que muestra la vista segun quien entra. */
export function SaludoPortal() {
  const cuenta = useMiCuenta();
  const portal = usePortal();
  const nombre = cuenta.data?.nombre?.split(' ')[0];
  const menor = portal.paciente?.nombre;
  const bajada = portal.responsable
    ? `Acá ves las horas, pagos y documentos${menor ? ` de ${menor}` : ' de tus menores a cargo'} y puedes escribirle a su profesional. El contenido de las sesiones no se muestra en esta vista.`
    : 'Acá ves tus horas, tus datos y puedes escribirle a tu profesional. El contenido de tus sesiones no se guarda en esta vista.';
  return (
    <>
      <Encabezado sobretitulo="Mi cuenta" titulo={nombre ? `Hola, ${nombre}.` : 'Hola.'} bajada={bajada} />
      {portal.restringida && (
        <Aviso tono="info" icono="shield_person" className="-mt-2 mb-[18px] max-w-[760px]">
          Tu cuenta es de adolescente: aquí ves tus horas, tus recordatorios y puedes escribirle a tu profesional. Pagos, documentos y consentimientos los ve tu
          adulto responsable.
        </Aviso>
      )}
      {portal.responsable && !portal.cargando && portal.pacientes.length === 0 && (
        <Aviso tono="info" icono="family_restroom" className="-mt-2 mb-[18px] max-w-[760px]">
          Tu cuenta todavía no tiene menores a cargo vinculados. Si llevas a un menor al centro, pide en recepción que te vinculen como su adulto responsable.
        </Aviso>
      )}
    </>
  );
}
