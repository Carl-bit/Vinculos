'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from './Icon';

/**
 * Modal sobre `<dialog>` nativo (foco atrapado, Escape y fondo inerte los da
 * el navegador). Mismo panel que el diseño: radio grande, sombra lg, fondo
 * crema. El foco vuelve al elemento que lo abrio al cerrar. Se monta en un
 * portal sobre `body` (solo en el cliente): asi nunca queda anidado dentro de
 * la tarjeta o la fila que lo abre.
 */
export function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  children,
  acciones,
  ancho = 'md',
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  descripcion?: ReactNode;
  children?: ReactNode;
  acciones?: ReactNode;
  ancho?: 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    else if (!abierto && d.open) d.close();
  }, [abierto, montado]);

  if (!montado) return null;
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={`${id}-titulo`}
      aria-describedby={descripcion ? `${id}-desc` : undefined}
      onClose={onCerrar}
      onCancel={(e) => {
        e.preventDefault();
        onCerrar();
      }}
      className={`m-auto w-[calc(100%-32px)] rounded-lg border border-divider bg-bg p-0 text-text shadow-lg backdrop:bg-neutral-900/40 open:entrada ${
        ancho === 'lg' ? 'max-w-[680px]' : 'max-w-[480px]'
      }`}
    >
      {abierto && (
        <div className="flex flex-col gap-4 px-[26px] pt-6 pb-[26px]">
          <div className="flex items-start gap-3">
            <h2 id={`${id}-titulo`} className="m-0 flex-1 text-[20px] leading-tight font-black tracking-[-0.025em] text-balance">
              {titulo}
            </h2>
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar"
              className="-mt-1 -mr-2 grid size-10 flex-none cursor-pointer place-items-center rounded-full text-neutral-700 hover:bg-accent-200 hover:text-accent-700"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
          {descripcion && (
            <div id={`${id}-desc`} className="m-0 text-[14px] leading-relaxed font-semibold text-pretty text-neutral-700">
              {descripcion}
            </div>
          )}
          {children}
          {acciones && <div className="mt-1 flex flex-wrap justify-end gap-2.5">{acciones}</div>}
        </div>
      )}
    </dialog>,
    document.body,
  );
}
