import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** AUD-02 (API-01): ninguna lista paginada devuelve mas de 100 filas por pagina. */
export const LIMITE_MAXIMO = 100;
export const LIMITE_POR_DEFECTO = 50;

/** Pagina por cursor: `cursor` = id de la ultima fila recibida (orden estable con id al final). */
export class PaginaDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  /** Filas por pagina (1 a 100, por defecto 50). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMO)
  limite?: number;
}

/**
 * Argumentos de Prisma para pedir una pagina: una fila de mas para saber si
 * hay otra pagina, y el cursor excluido (skip 1).
 */
export const argumentosPagina = (p: PaginaDto) => ({
  take: (p.limite ?? LIMITE_POR_DEFECTO) + 1,
  ...(p.cursor ? { cursor: { id: p.cursor }, skip: 1 } : {}),
});

/** Corta la fila de mas y arma el cursor siguiente (null = ultima pagina). */
export function pagina<T extends { id: string }>(filas: T[], p: PaginaDto): { items: T[]; siguienteCursor: string | null } {
  const limite = p.limite ?? LIMITE_POR_DEFECTO;
  const items = filas.slice(0, limite);
  return { items, siguienteCursor: filas.length > limite ? items[items.length - 1].id : null };
}
