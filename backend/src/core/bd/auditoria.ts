import type { Tx, UsuarioActual } from './contexto-bd.service';

/** AUD-01: DESCARGA = copia o archivo bajado; EXPORTACION = salida estructurada de datos. */
export type AccionAcceso = 'LECTURA' | 'ESCRITURA' | 'ENVIO' | 'DESCARGA' | 'EXPORTACION';

/**
 * Registra un acceso a datos clinicos en accesos_ficha, en la misma
 * transaccion de la request (requisitos_02_apis.md 12). createMany: la RLS
 * de accesos_ficha deja insertar filas propias pero solo ADMIN las lee, asi
 * que un INSERT ... RETURNING fallaria para los demas roles.
 */
export async function registrarAcceso(
  tx: Tx,
  usuario: UsuarioActual,
  filas: { pacienteId: string; fichaId?: string | null; recurso: string; accion: AccionAcceso; detalle?: string }[],
): Promise<void> {
  if (filas.length === 0) {
    return;
  }
  await tx.accesoFicha.createMany({
    data: filas.map((f) => ({
      usuarioId: usuario.id,
      rol: usuario.rol,
      pacienteId: f.pacienteId,
      fichaId: f.fichaId ?? null,
      recurso: f.recurso,
      accion: f.accion,
      detalle: f.detalle ?? null,
    })),
  });
}

/**
 * AUD-01 (E1.5): descarga o exportacion que no es de un paciente (PDF de
 * cobros y liquidaciones, exportacion del centro). Misma transaccion; solo
 * ADMIN lo lee (createMany por la misma razon que registrarAcceso).
 */
export async function registrarExportacion(
  tx: Tx,
  usuario: UsuarioActual,
  fila: { recurso: string; referenciaId?: string | null; detalle?: string },
): Promise<void> {
  await tx.registroExportacion.createMany({
    data: [{ usuarioId: usuario.id, rol: usuario.rol, recurso: fila.recurso, referenciaId: fila.referenciaId ?? null, detalle: fila.detalle ?? null }],
  });
}
