import { useEffect, useState } from 'react';

/**
 * Debounce (03b-6): devuelve `valor` recien cuando deja de cambiar por `ms`.
 * Para busquedas que consultan la API (una peticion al terminar de escribir,
 * no una por tecla). Los filtros sobre datos ya cargados no lo necesitan.
 */
export function useRetardado<T>(valor: T, ms = 300): T {
  const [retardado, setRetardado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setRetardado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return retardado;
}
