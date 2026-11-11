import { describe, expect, it } from 'vitest';

import { paginasVisibles } from './Paginador';

describe('paginasVisibles', () => {
  it('pocas paginas: todas', () => expect(paginasVisibles(2, 4)).toEqual([1, 2, 3, 4]));
  it('al medio: primera, vecinas y ultima con saltos', () => expect(paginasVisibles(7, 12)).toEqual([1, '…', 6, 7, 8, '…', 12]));
  it('en un extremo: sin salto doble', () => expect(paginasVisibles(1, 12)).toEqual([1, 2, '…', 12]));
  it('vecina de la primera: sin "…" entre 1 y 2', () => expect(paginasVisibles(3, 12)).toEqual([1, 2, 3, 4, '…', 12]));
});
