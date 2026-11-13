import { useSyncExternalStore } from 'react';

import { cambiarRol, type Rol, type SesionActiva } from './sesion';

/*
 * Cambio de rol con pantalla de carga: desde el clic hasta que llega el token
 * nuevo, el modulo queda bajo su esqueleto (CargaModulo). Despues lo retiene
 * el propio CargaModulo, que se reinicia al cambiar el rol (key del <main>)
 * y espera las consultas del rol nuevo. LayoutAdmin baja la marca cuando el
 * rol activo cambia.
 */
let cambiando = false;
const oyentes = new Set<() => void>();

function fijar(valor: boolean): void {
  if (cambiando === valor) return;
  cambiando = valor;
  oyentes.forEach((o) => o());
}

export function terminarCambioRol(): void {
  fijar(false);
}

export function useCambiandoRol(): boolean {
  return useSyncExternalStore(
    (oyente) => {
      oyentes.add(oyente);
      return () => oyentes.delete(oyente);
    },
    () => cambiando,
    () => false,
  );
}

/** cambiarRol con la marca de carga; si falla, la baja y relanza el error. */
export async function cambiarRolConCarga(rol: Rol): Promise<SesionActiva> {
  fijar(true);
  try {
    return await cambiarRol(rol);
  } catch (e) {
    fijar(false);
    throw e;
  }
}
