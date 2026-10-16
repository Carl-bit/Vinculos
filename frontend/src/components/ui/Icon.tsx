import type { Icono } from '@/lib/iconos';

/** Icono de Material Symbols Rounded (decorativo salvo que traiga `label`). */
export function Icon({ name, size = 18, label, className = '' }: { name: Icono; size?: number; label?: string; className?: string }) {
  return (
    <span
      className={`ms flex-none ${className}`}
      style={{ fontSize: size }}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {name}
    </span>
  );
}
