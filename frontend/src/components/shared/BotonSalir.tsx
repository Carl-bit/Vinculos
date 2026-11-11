'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cerrarSesion } from '@/lib/sesion';

/** Cierra la sesion (revoca el refresh en la API), vacia la cache y vuelve al login. */
export function BotonSalir({ className = '', grande = false }: { className?: string; grande?: boolean }) {
  const router = useRouter();
  const cliente = useQueryClient();
  const [saliendo, setSaliendo] = useState(false);
  const salir = async () => {
    setSaliendo(true);
    try {
      await cerrarSesion();
    } finally {
      cliente.clear();
      router.replace('/ingreso');
    }
  };
  // Grande (tarjeta de la cuenta del portal, punto 42): ancho, con texto y el color de salida (terracota).
  if (grande)
    return (
      <Button
        variant="primary"
        size="lg"
        icon="logout"
        loading={saliendo}
        onClick={() => void salir()}
        className={`w-full !border-accent-700 !bg-accent-700 !text-neutral-100 hover:!bg-accent-800 ${className}`}
      >
        Salir
      </Button>
    );
  return (
    <button
      type="button"
      onClick={() => void salir()}
      disabled={saliendo}
      aria-label="Cerrar sesión"
      title="Cerrar sesión"
      className={`grid size-10 cursor-pointer place-items-center rounded-full text-neutral-700 transition-colors duration-200 ease-out hover:bg-accent-200 hover:text-accent-700 ${className}`}
    >
      <Icon name="logout" size={18} />
    </button>
  );
}
