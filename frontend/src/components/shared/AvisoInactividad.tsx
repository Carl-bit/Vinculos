'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cerrarSesion, msHastaInactividad, seguirConectado } from '@/lib/sesion';

/** Desde cuanto antes del cierre se avisa. */
export const AVISO_INACTIVIDAD_MS = 2 * 60_000;

/** "1:05" desde milisegundos (nunca negativo). */
export const cuentaRegresiva = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Punto 17: aviso con cuenta regresiva antes de cerrar la sesion por
 * inactividad (la sesion igual se cierra sola al llegar a cero, lib/sesion).
 * La actividad en otra pestaña tambien lo cierra.
 */
export function AvisoInactividad() {
  const router = useRouter();
  const cliente = useQueryClient();
  const [restante, setRestante] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => setRestante(msHastaInactividad()), 1000);
    return () => clearInterval(t);
  }, []);
  const abierto = restante !== null && restante > 0 && restante <= AVISO_INACTIVIDAD_MS;
  const salir = async () => {
    await cerrarSesion();
    cliente.clear();
    router.replace('/ingreso');
  };
  return (
    <Modal abierto={abierto} onCerrar={seguirConectado} titulo="¿Sigues ahí?" descripcion="Por tu seguridad, la sesión se cierra tras un tiempo sin actividad.">
      <div className="flex flex-col gap-4">
        <p className="m-0 text-[15px] font-semibold" aria-live="polite">
          Se cerrará en <strong className="text-[22px] font-black tabular-nums">{cuentaRegresiva(restante ?? 0)}</strong>
        </p>
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="ghost" onClick={() => void salir()}>
            Cerrar sesión
          </Button>
          <Button variant="team" onClick={seguirConectado}>
            Seguir conectado
          </Button>
        </div>
      </div>
    </Modal>
  );
}
