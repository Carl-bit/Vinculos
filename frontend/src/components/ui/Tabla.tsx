import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

/**
 * Tabla del diseño (Fichas y Pacientes): encabezado en mayusculas chicas,
 * filas con separador y hover suave. En pantallas angostas hace scroll
 * horizontal dentro de su contenedor (nunca la pagina).
 */
export function Tabla({ children, etiqueta }: { children: ReactNode; etiqueta: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-divider bg-bg shadow-sm">
      <table aria-label={etiqueta} className="w-full min-w-[640px] border-collapse text-left">
        {children}
      </table>
    </div>
  );
}

export function Th({ className = '', ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`border-b border-divider px-[18px] py-3.5 text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase ${className}`}
      {...props}
    />
  );
}

export function Td({ className = '', ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={`border-b border-divider px-[18px] py-3.5 align-middle text-[14px] ${className}`} {...props} />;
}
