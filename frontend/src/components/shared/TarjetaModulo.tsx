import Link from 'next/link';

import { Icon } from '@/components/ui/Icon';
import type { Icono } from '@/lib/iconos';

/**
 * Tarjeta de modulo del Dashboard: icono en circulo (como el diseño), nombre,
 * descripcion y estado. Un modulo no contratado no es enlace: solo informa.
 */
export function TarjetaModulo({
  nombre,
  descripcion,
  icono,
  href,
  meta,
  activo,
}: {
  nombre: string;
  descripcion: string;
  icono: Icono;
  href?: string;
  meta: string;
  activo: boolean;
}) {
  const cuerpo = (
    <>
      <div className="flex items-center gap-3">
        <span
          className={`grid size-[38px] flex-none place-items-center rounded-full border ${
            activo ? 'border-accent-2-500 bg-accent-2-200 text-accent-2-700' : 'border-neutral-400 bg-neutral-200 text-neutral-700'
          }`}
        >
          <Icon name={icono} size={20} />
        </span>
        <span className="flex-1 text-[16.5px] font-black tracking-[-0.02em]">{nombre}</span>
        <Icon name={activo ? 'chevron_right' : 'lock'} size={18} className="text-neutral-500" />
      </div>
      <p className="m-0 text-[13.5px] leading-normal font-semibold text-pretty text-neutral-700">{descripcion}</p>
      <span
        className={`border-t border-divider pt-1 text-[11.5px] font-extrabold tracking-[0.06em] uppercase ${activo ? 'text-accent-2-700' : 'text-neutral-700'}`}
      >
        {meta}
      </span>
    </>
  );
  const clases = 'flex flex-col gap-3.5 rounded-lg border border-divider bg-bg p-[22px] text-text shadow-sm';
  return activo && href ? (
    <Link href={href} className={`${clases} transition-[box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:text-text hover:shadow-lg`}>
      {cuerpo}
    </Link>
  ) : (
    <div className={`${clases} opacity-70`}>{cuerpo}</div>
  );
}
