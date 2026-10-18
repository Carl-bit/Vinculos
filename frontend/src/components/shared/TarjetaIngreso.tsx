import type { ReactNode } from 'react';

export type PerfilIngreso = 'paciente' | 'equipo';

/**
 * Tarjeta de vidrio sobre manchas difusas (diseño "Inicio de Sesion"),
 * compartida por el login y las paginas de cuenta (recuperar, enlace de
 * acceso, activar). Paciente en accent-2, equipo en accent.
 */
export function TarjetaIngreso({ perfil = 'paciente', children }: { perfil?: PerfilIngreso; children: ReactNode }) {
  return (
    <>
      <Fondo perfil={perfil} />
      <div className="w-full max-w-[452px] rounded-lg border border-white/75 bg-[rgba(255,252,246,0.66)] px-[clamp(24px,3vw,34px)] py-[clamp(26px,3vw,34px)] shadow-lg backdrop-blur-[22px]">
        {children}
      </div>
    </>
  );
}

/** Manchas difusas de fondo, como en el diseño (derivan lento; se apagan con movimiento reducido). */
function Fondo({ perfil }: { perfil: PerfilIngreso }) {
  const [base, a, b] = perfil === 'paciente' ? ['bg-accent-2-100', 'bg-accent-2-300', 'bg-accent-2-200'] : ['bg-accent-100', 'bg-accent-300', 'bg-accent-200'];
  return (
    <div aria-hidden="true" className={`fixed inset-0 -z-10 overflow-hidden transition-colors duration-500 ${base}`}>
      <span className={`absolute top-[-14%] left-[-8%] size-[52vw] animate-[deriva_22s_ease-in-out_infinite] rounded-full opacity-85 blur-[60px] ${a}`} />
      <span
        className={`absolute right-[-6%] bottom-[-20%] size-[46vw] animate-[deriva_28s_ease-in-out_infinite_reverse] rounded-full opacity-90 blur-[70px] ${b}`}
      />
      <span className="absolute top-[32%] right-[22%] size-[26vw] animate-[deriva_34s_ease-in-out_infinite] rounded-full bg-bg opacity-75 blur-[60px]" />
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
