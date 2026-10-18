'use client';

import type { ReactNode } from 'react';

import { ButtonLink } from '@/components/ui/ButtonLink';
import { usePortal } from './ContextoPortal';
import { EstadoVista } from './EstadoVista';

/** Secciones que la cuenta restringida del adolescente no ve (D-4). La API igual se lo niega; esto solo explica por que. */
export function SoloCuentaPlena({ children }: { children: ReactNode }) {
  const portal = usePortal();
  if (portal.cargando) return <EstadoVista estado="carga" />;
  if (portal.restringida) {
    return (
      <EstadoVista
        estado="sin-permiso"
        titulo="Esta sección la ve tu adulto responsable"
        mensaje="En tu cuenta ves tus horas, tus recordatorios y puedes escribirle a tu profesional."
        accion={
          <ButtonLink href="/portal" variant="secondary" icon="person">
            Ir a mi cuenta
          </ButtonLink>
        }
      />
    );
  }
  if (portal.responsable && portal.pacientes.length === 0) {
    return (
      <EstadoVista estado="vacio" titulo="Todavía no tienes menores a cargo vinculados" mensaje="Pide en recepción que te vinculen como adulto responsable." />
    );
  }
  return <>{children}</>;
}
