import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRetardado } from './useRetardado';

describe('useRetardado', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('entrega el ultimo valor solo cuando deja de cambiar', () => {
    const { result, rerender } = renderHook(({ v }) => useRetardado(v, 300), { initialProps: { v: 'a' } });
    rerender({ v: 'an' });
    rerender({ v: 'ana' });
    act(() => vi.advanceTimersByTime(299));
    expect(result.current).toBe('a');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('ana');
  });
});
