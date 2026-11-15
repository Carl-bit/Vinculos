import { createHash } from 'node:crypto';

/**
 * Tope de correos de cuenta por direccion (recuperacion y enlace de acceso,
 * exista o no la cuenta): evita usar el formulario para llenar de correos una
 * casilla ajena. En memoria y por instancia de la API (un silo = una
 * instancia). Guarda solo el sha256 de la direccion, nunca la direccion.
 */
export class LimitePorCorreo {
  private readonly marcas = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly ventanaMs: number,
  ) {}

  /** true si todavia se puede enviar a esa direccion (y lo registra). */
  permitir(email: string, ahora = Date.now()): boolean {
    const clave = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    const desde = ahora - this.ventanaMs;
    const previas = (this.marcas.get(clave) ?? []).filter((t) => t > desde);
    if (previas.length >= this.max) {
      this.marcas.set(clave, previas);
      return false;
    }
    previas.push(ahora);
    this.marcas.set(clave, previas);
    if (this.marcas.size > 10_000) this.limpiar(ahora);
    return true;
  }

  private limpiar(ahora: number) {
    const desde = ahora - this.ventanaMs;
    for (const [k, ts] of this.marcas) if (!ts.some((t) => t > desde)) this.marcas.delete(k);
  }
}
