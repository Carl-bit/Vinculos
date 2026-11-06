import type { ReactNode } from 'react';

export type PerfilIngreso = 'paciente' | 'equipo';

/**
 * Tarjeta translucida sobre la trama de puntos del sitio publico (diseño
 * "Inicio de sesión · Moderno"), compartida por el login y las paginas de
 * cuenta (recuperar, enlace de acceso, activar). El color del perfil
 * (paciente en accent-2, equipo en accent) lo llevan los botones de adentro;
 * `perfil` se acepta por compatibilidad con las paginas de cuenta.
 */
export function TarjetaIngreso({ children }: { perfil?: PerfilIngreso; children: ReactNode }) {
  return (
    <div className="translucida w-full max-w-[460px] flex-[1_1_400px] rounded-[32px] border border-borde px-[clamp(22px,3vw,32px)] py-[clamp(24px,3vw,32px)] shadow-flotante">
      {children}
    </div>
  );
}

/** Titulo de la tarjeta: h1 grande y bajada (misma escala que el login). */
export function TituloIngreso({ titulo, bajada }: { titulo: string; bajada?: ReactNode }) {
  return (
    <>
      <h1 className="m-0 mb-2.5 text-[clamp(27px,3vw,33px)] leading-[1.05] font-black tracking-[-0.03em] text-balance">{titulo}</h1>
      {bajada && <div className="m-0 mb-6 text-[14.5px] leading-relaxed text-pretty text-neutral-700">{bajada}</div>}
    </>
  );
}
