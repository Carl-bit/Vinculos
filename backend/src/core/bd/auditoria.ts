import type { Tx, UsuarioActual } from './contexto-bd.service';

export type AccionAcceso = 'LECTURA' | 'ESCRITURA';

/**
 * Registra un acceso a datos clinicos en accesos_ficha, en la misma
 * transaccion de la request (requisitos_02_apis.md 12). createMany: la RLS
 * de accesos_ficha deja insertar filas propias pero solo ADMIN las lee, asi
 * que un INSERT ... RETURNING fallaria para los demas roles.
 */
export async function registrarAcceso(
  tx: Tx,
  usuario: UsuarioActual,
  filas: { pacienteId: string; fichaId?: string | null; recurso: string; accion: AccionAcceso }[],
): Promise<void> {
  if (filas.length === 0) {
    return;
  }
  await tx.accesoFicha.createMany({
    data: filas.map((f) => ({ usuarioId: usuario.id, rol: usuario.rol, pacienteId: f.pacienteId, fichaId: f.fichaId ?? null, recurso: f.recurso, accion: f.accion })),
  });
}
