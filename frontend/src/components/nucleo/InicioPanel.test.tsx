import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InicioPanel } from './InicioPanel';

const lista = <T,>(data: T) => ({ isPending: false, isSuccess: true, error: null, data, refetch: vi.fn() });
const MIN = 60_000;
const iso = (desdeAhoraMin: number) => new Date(Date.now() + desdeAhoraMin * MIN).toISOString();

const citas = [
  // En curso (empezo hace 10 min) y otra en una hora.
  { id: 'c1', estado: 'CONFIRMADA', inicio: iso(-10), fin: iso(40), profesionalId: 'p1', pacienteId: 'pa1', espacioId: 'b1', modalidad: 'PRESENCIAL' },
  { id: 'c2', estado: 'PENDIENTE_PAGO', inicio: iso(60), fin: iso(110), profesionalId: 'p1', pacienteId: 'pa2', espacioId: null, modalidad: 'ONLINE' },
];
const mensajes = vi.fn(() => lista([{ id: 'm1', pacienteId: 'pa1', leidoEn: null, creadoEn: iso(-120), contenido: 'x', profesionalId: 'p1' }]));

vi.mock('@/components/shared/EquipoActivo', () => ({ useEquipoActivo: () => ({ profesionalId: null }) }));
vi.mock('./MisRecordatorios', () => ({ MisRecordatorios: () => <section aria-label="Mis recordatorios" /> }));
vi.mock('@/lib/consultas', () => ({ useMiCuenta: () => lista({ id: 'p1' }) }));
vi.mock('@/lib/exportaciones', () => ({ useExportacionesPendientes: () => lista([]) }));
vi.mock('@/lib/mensajes', () => ({ useMensajesPacientes: () => mensajes() }));
vi.mock('@/lib/panel', async (original) => ({
  ...(await original<typeof import('@/lib/panel')>()),
  useDashboard: () =>
    lista({
      rol: 'PROFESIONAL',
      sesiones_hoy: 2,
      sesiones_semana: 6,
      pacientes_activos: 9,
      fichas_sin_cerrar: 1,
      borradores: 0,
      calificacion: 4.8,
      resenas: 3,
      modulos: ['AGENDA', 'FICHAS'],
      pendientes: null,
      por_confirmar: 0,
      ocupacion_boxes_hoy: 40,
      boxes_activos: 2,
      fichas_por_cerrar: 3,
    }),
  useCitas: () => lista(citas),
  useEstadoFichas: () =>
    lista([
      { paciente_id: 'pa3', ultima_sesion: iso(-60 * 24 * 45), proxima_sesion: null, alta_en: null, sesiones_sin_cerrar: 0 },
      { paciente_id: 'pa1', ultima_sesion: iso(-60 * 24 * 3), proxima_sesion: iso(60), alta_en: null, sesiones_sin_cerrar: 1 },
    ]),
  usePacientes: () =>
    lista([
      { id: 'pa1', nombre: 'Ana', apellido: 'Demo' },
      { id: 'pa2', nombre: 'Beto', apellido: 'Demo' },
    ]),
  useEspacios: () => lista([{ id: 'b1', nombre: 'Box 1' }]),
  useEquipoAgenda: () => lista([{ id: 'p1', nombre: 'Profesional Uno' }]),
}));

/** Orden en el documento: a aparece antes que b. */
const antes = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('InicioPanel (03b-4.2)', () => {
  it('PROFESIONAL: sesion en curso primero, linea del dia, indicadores y luego semana/pendientes/recordatorios', () => {
    render(<InicioPanel rol="PROFESIONAL" />);
    const foco = screen.getByText('Sesión en curso');
    expect(screen.getByRole('link', { name: /Registrar evolución/ })).toHaveAttribute('href', '/admin/fichas/pa1?vista=evoluciones&cita=c1');
    expect(screen.getByRole('link', { name: /Abrir ficha/ })).toHaveAttribute('href', '/admin/fichas/pa1');
    // Mensaje del portal anterior a la sesion.
    expect(screen.getByText(/te escribió desde el portal/)).toBeInTheDocument();
    const linea = screen.getByRole('region', { name: 'Sesiones de hoy' });
    const semana = screen.getByRole('heading', { name: 'Esta semana' });
    expect(antes(foco, linea) && antes(linea, semana)).toBe(true);
    // La linea termina en la agenda completa.
    expect(within(linea).getAllByRole('link').at(-1)).toHaveAttribute('href', '/admin/agenda');
    expect(screen.getByText('Sin sesión hace +1 mes').closest('a')).toHaveAttribute('href', '/admin/fichas?filtro=sin-sesion');
    expect(screen.getByRole('region', { name: 'Mis recordatorios' })).toBeInTheDocument();
    // Fuera del inicio: modulos (repetian el menu) y calificacion (vive en Mi perfil).
    expect(screen.queryByText('Módulos del centro')).toBeNull();
    expect(screen.queryByText('Calificación')).toBeNull();
  });

  it('ADMIN: datos del centro sin acciones ni datos clinicos', () => {
    mensajes.mockClear();
    render(<InicioPanel rol="ADMIN" />);
    expect(screen.getByRole('heading', { name: 'Hoy en el centro' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Registrar evolución|Abrir ficha/ })).toBeNull();
    expect(screen.queryByText(/te escribió desde el portal/)).toBeNull();
    expect(mensajes).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Mis recordatorios' })).toBeInTheDocument();
  });
});
