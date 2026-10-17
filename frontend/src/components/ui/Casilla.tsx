import type { ReactNode } from 'react';

/** Casilla obligatoria con forma de tarjeta (aceptar politicas): borde segun estado y error debajo. */
export function Casilla({ checked, onChange, error, children }: { checked: boolean; onChange: (v: boolean) => void; error?: string; children: ReactNode }) {
  return (
    <div>
      <label
        className={`flex cursor-pointer items-start gap-[11px] rounded-[18px] border-[1.5px] bg-bg px-[18px] py-4 text-[13.5px] leading-[1.55] font-bold text-pretty ${
          error ? 'border-accent-700' : checked ? 'border-accent-2-600' : 'border-neutral-400'
        }`}
      >
        <input
          type="checkbox"
          required
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-[18px] flex-none cursor-pointer accent-accent-2-600"
        />
        <span>{children}</span>
      </label>
      {error && <p className="m-0 mt-1.5 text-[12.5px] font-bold text-accent-700">{error}</p>}
    </div>
  );
}
