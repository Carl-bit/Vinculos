import { describe, expect, it } from 'vitest';

import { abiertaDe, bloqueoSolicitud, estadoSolicitud, type SolicitudModulo } from './SolicitudesModulo';

describe('Solicitudes de modulos (tarea 31)', () => {
  it('mismas dependencias que solicitar_modulo() en la BD', () => {
    expect(bloqueoSolicitud('MATCH', 'ACTIVAR', ['FICHAS'])).toMatch(/Equipo/);
    expect(bloqueoSolicitud('PAGINA_PUBLICA', 'ACTIVAR', ['FICHAS'])).toMatch(/Equipo/);
    expect(bloqueoSolicitud('MATCH', 'ACTIVAR', ['EQUIPO'])).toBeNull();
    expect(bloqueoSolicitud('EQUIPO', 'DESACTIVAR', ['EQUIPO', 'MATCH'])).toMatch(/dependen/);
    expect(bloqueoSolicitud('EQUIPO', 'DESACTIVAR', ['EQUIPO'])).toBeNull();
  });

  it('solo pendiente o aprobada cuentan como abierta', () => {
    const s = (estado: SolicitudModulo['estado']): SolicitudModulo => ({
      id: estado,
      modulo: 'MATCH',
      accion: 'ACTIVAR',
      motivo: null,
      estado,
      respuesta: null,
      pedidaEn: '2026-11-13T12:00:00Z',
      respondidaEn: null,
    });
    expect(abiertaDe([s('RECHAZADA'), s('APLICADA')], 'MATCH')).toBeUndefined();
    expect(abiertaDe([s('RECHAZADA'), s('APROBADA')], 'MATCH')?.id).toBe('APROBADA');
    expect(abiertaDe([s('PENDIENTE')], 'EQUIPO')).toBeUndefined();
  });
});

describe('estado de la solicitud para el ADMIN', () => {
  it('en curso va en amarillo y dice que se esta activando o desactivando', () => {
    expect(estadoSolicitud({ estado: 'PENDIENTE', accion: 'DESACTIVAR' })).toEqual({ texto: 'Desactivación solicitada', tono: 'pendiente' });
    expect(estadoSolicitud({ estado: 'APROBADA', accion: 'DESACTIVAR' })).toEqual({ texto: 'Desactivación en proceso', tono: 'pendiente' });
    expect(estadoSolicitud({ estado: 'APROBADA', accion: 'ACTIVAR' })).toEqual({ texto: 'Activación en proceso', tono: 'pendiente' });
  });

  it('aplicada: activado o desactivado', () => {
    expect(estadoSolicitud({ estado: 'APLICADA', accion: 'DESACTIVAR' })).toEqual({ texto: 'Desactivado', tono: 'neutro' });
    expect(estadoSolicitud({ estado: 'APLICADA', accion: 'ACTIVAR' })).toEqual({ texto: 'Activado', tono: 'positivo' });
  });
});
