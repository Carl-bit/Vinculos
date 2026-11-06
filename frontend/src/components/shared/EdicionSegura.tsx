'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * Edicion con cambios sin guardar (03c, Moderno A). Piezas:
 * - `useGuardaCambios` (useDirtyGuard): con cambios, pide confirmar antes de
 *   salir por un enlace interno, recargar o cerrar la pestaña.
 * - `DialogoDescartar` (ConfirmDiscardDialog): "Estás modificando <sección>".
 * - `BarraSinGuardar` (UnsavedBar): barra flotante con Guardar y Descartar.
 * - `EditorEnfocado` + `SeccionEnfocable` (FocusEditor): una sección enfocada,
 *   el resto atenuado; clic fuera o Escape = quitar la selección.
 */

/**
 * Con `sucio`: intercepta los clics en enlaces internos (fase de captura, antes
 * que el <Link> de Next) y el beforeunload. `confirmar(accion)` corre la accion
 * de inmediato si no hay cambios, o abre el dialogo y la corre con "Sí".
 * ponytail: el boton Atras del navegador no se intercepta (App Router no tiene
 * bloqueo de rutas); el beforeunload solo cubre recargar o cerrar.
 */
export function useGuardaCambios(sucio: boolean) {
  const router = useRouter();
  const [pendiente, setPendiente] = useState<(() => void) | null>(null);
  const sucioRef = useRef(sucio);
  sucioRef.current = sucio;

  useEffect(() => {
    if (!sucio) return;
    const antesDeSalir = (e: BeforeUnloadEvent) => e.preventDefault();
    const clic = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(a instanceof HTMLAnchorElement) || a.target === '_blank' || a.hasAttribute('download') || a.origin !== location.origin) return;
      const destino = a.pathname + a.search + a.hash;
      if (destino === location.pathname + location.search + location.hash) return;
      e.preventDefault();
      e.stopPropagation();
      setPendiente(() => () => router.push(destino));
    };
    window.addEventListener('beforeunload', antesDeSalir);
    document.addEventListener('click', clic, true);
    return () => {
      window.removeEventListener('beforeunload', antesDeSalir);
      document.removeEventListener('click', clic, true);
    };
  }, [sucio, router]);

  const confirmar = useCallback((accion: () => void) => (sucioRef.current ? setPendiente(() => accion) : accion()), []);

  return {
    confirmar,
    dialogo: {
      abierto: pendiente !== null,
      onDescartar: () => {
        const accion = pendiente;
        setPendiente(null);
        accion?.();
      },
      onSeguir: () => setPendiente(null),
    },
  };
}

export function DialogoDescartar({
  seccion,
  abierto,
  onDescartar,
  onSeguir,
}: {
  seccion: string;
  abierto: boolean;
  onDescartar: () => void;
  onSeguir: () => void;
}) {
  return (
    <Modal
      abierto={abierto}
      onCerrar={onSeguir}
      titulo={`Estás modificando «${seccion}»`}
      descripcion="¿Seguro que quieres descartar los cambios?"
      acciones={
        <>
          <Button variant="secondary" onClick={onDescartar}>
            Sí, descartar
          </Button>
          <Button variant="team" onClick={onSeguir}>
            No, seguir editando
          </Button>
        </>
      }
    />
  );
}

/** Barra flotante al pie: aparece solo con cambios. */
export function BarraSinGuardar({
  visible,
  guardando,
  error,
  textoGuardar = 'Guardar',
  onGuardar,
  onDescartar,
}: {
  visible: boolean;
  guardando?: boolean;
  error?: string;
  textoGuardar?: string;
  onGuardar: () => void;
  onDescartar: () => void;
}) {
  if (!visible) return null;
  return (
    <div
      role="region"
      aria-label="Cambios sin guardar"
      className="entrada sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-full border border-borde py-2 pr-2 pl-5 text-tinta translucida shadow-flotante"
    >
      {error ? (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      ) : (
        <p className="m-0 text-[13px] font-bold">Tienes cambios sin guardar.</p>
      )}
      <Button variant="secondary" disabled={guardando} onClick={onDescartar}>
        Descartar
      </Button>
      <Button variant="team" loading={guardando} onClick={onGuardar}>
        {textoGuardar}
      </Button>
    </div>
  );
}

/**
 * Contenedor del editor enfocado. Con una seccion activa, un fondo invisible
 * recibe el clic fuera y Escape hace lo mismo: `onQuitar` (quien lo usa decide
 * si confirmar con `useGuardaCambios`).
 */
export function EditorEnfocado({
  activa,
  onQuitar,
  className = 'flex flex-col gap-3',
  children,
}: {
  activa: boolean;
  onQuitar: () => void;
  /** Disposicion de las secciones (por defecto, en columna). */
  className?: string;
  children: ReactNode;
}) {
  const quitar = useRef(onQuitar);
  quitar.current = onQuitar;
  useEffect(() => {
    if (!activa) return;
    // Escape en cualquier parte, salvo dentro de un dialogo abierto (lo cierra el propio dialogo).
    const tecla = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && !document.querySelector('dialog[open]') && quitar.current();
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [activa]);
  return (
    <div className="relative">
      {activa && <button type="button" tabIndex={-1} aria-label="Quitar la selección" onClick={onQuitar} className="absolute inset-0 z-0 cursor-default" />}
      <div className={`relative z-[1] ${className}`}>{children}</div>
    </div>
  );
}

/**
 * Seccion seleccionable: la activa con anillo arcilla, las otras atenuadas
 * (opacidad 0.32 y blur leve, sin transicion con prefers-reduced-motion).
 */
export function SeccionEnfocable({
  etiqueta,
  activa,
  atenuada,
  onElegir,
  children,
}: {
  etiqueta: string;
  activa: boolean;
  atenuada: boolean;
  onElegir: () => void;
  children: ReactNode;
}) {
  const tecla = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    onElegir();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={activa}
      aria-label={`Editar ${etiqueta}`}
      onClick={onElegir}
      onKeyDown={tecla}
      className={`cursor-pointer rounded-tarjeta p-4 transition-[opacity,filter,background-color] duration-200 ease-out ${
        activa ? 'bg-papel outline-3 outline-arcilla' : 'hover:bg-papel/60'
      } ${atenuada ? 'opacity-[0.32] blur-[1.5px] grayscale-[0.4]' : ''}`}
    >
      {children}
    </div>
  );
}
