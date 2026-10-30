import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { semanaChile } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { CalendarioAgenda, type ModoAgenda } from './CalendarioAgenda';

/** Consulta resuelta con datos (forma minima que usa EstadoConsulta). */
const lista = <T,>(data: T) => ({ isPending: false, isSuccess: true, error: null, data, refetch: vi.fn() });

// Martes de la semana pasada: queda "pasada" (estado segun evolucion) y dentro de la semana -1.
const martes = semanaChile(-1).dias[1]!;
const enChile = (hora: string) => new Date(`${martes}T${hora}:00-03:00`).toISOString();

const cita = (id: string, desde: string, hasta: string, extra: Record<string, unknown> = {}) => ({
  id,
  estado: 'CONFIRMADA',
  inicio: enChile(desde),
  fin: enChile(hasta),
  profesionalId: 'p1',
  pacienteId: 'pa1',
  espacioId: 'b1',
  modalidad: 'PRESENCIAL',
  ...extra,
});

/** Respuestas de la API por ruta (useQuery directo del componente). */
const respuestas: Record<string, unknown> = {};
vi.mock('@/lib/api/cliente', () => ({
  api: { GET: (ruta: string) => Promise.resolve(ruta) },
  datos: async (r: Promise<string>) => respuestas[await r] ?? [],
}));
vi.mock('@/components/shared/EquipoActivo', () => ({ useEquipoActivo: () => ({ profesionalId: null, setProfesionalId: vi.fn() }) }));
vi.mock('@/lib/consultas', () => ({
  useMiCuenta: () => lista({ id: 'p1' }),
  useModulos: () => lista({ activos: ['AGENDA', 'FICHAS', 'COBROS'] }),
}));
let citas: unknown[] = [];
vi.mock('@/lib/panel', async (original) => ({
  ...(await original<typeof import('@/lib/panel')>()),
  useCitas: () => lista(citas),
  useRetencionesAjenas: () => lista([{ espacioId: 'b1', inicio: enChile('15:00'), fin: enChile('15:50') }]),
  useEquipoAgenda: () =>
    lista([
      { id: 'p1', nombre: 'Profesional Uno' },
      { id: 'p2', nombre: 'Profesional Dos' },
    ]),
  useEspacios: () =>
    lista([
      { id: 'b1', nombre: 'Box 1', activo: true },
      { id: 'b2', nombre: 'Box 2', activo: true },
    ]),
  usePacientes: () => lista([{ id: 'pa1', nombre: 'Ana', apellido: 'Demo' }]),
}));

function Agenda({ rol, modo = 'profesional' }: { rol: Rol; modo?: ModoAgenda }) {
  return <CalendarioAgenda rol={rol} modo={modo} onElegir={vi.fn()} onAgendar={vi.fn()} />;
}
const conCliente = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

/** La agenda abre en la semana actual: vuelve a la semana del martes de prueba. */
async function semanaAnterior() {
  await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
}

describe('CalendarioAgenda (03b-4.2)', () => {
  beforeEach(() => {
    localStorage.clear();
    citas = [cita('c1', '10:00', '10:50')];
    for (const k of Object.keys(respuestas)) delete respuestas[k];
  });

  it('grilla de 08:00 a 24:00 estirada al alto: posicion y alto en %; sin tarjetas "Libre" fuera de un box; contador por dia', async () => {
    conCliente(<Agenda rol="ADMIN" />);
    await semanaAnterior();
    const caja = screen.getByRole('button', { name: /10:00 Ana Demo/ }).parentElement!;
    // 10:00 = 2 h de 16; 50 min.
    expect(parseFloat(caja.style.top)).toBeCloseTo((120 / 960) * 100);
    expect(parseFloat(caja.style.height)).toBeCloseTo((50 / 960) * 100);
    expect(screen.getByText('08:00')).toBeInTheDocument();
    expect(screen.queryByText('07:00')).toBeNull();
    expect(screen.queryByText('Libre')).toBeNull();
    expect(screen.getAllByText('1 cita').length).toBeGreaterThan(0);
  });

  it('Semana | Mes (sin Dia) con Anterior, Hoy y Siguiente', async () => {
    conCliente(<Agenda rol="ADMIN" />);
    const hoy = screen.getByRole('button', { name: 'Hoy' });
    expect(hoy).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(hoy).toBeEnabled();
    expect(screen.queryByRole('radio', { name: 'Día' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Mes' }));
    expect(screen.getByRole('region', { name: 'Calendario del mes' })).toBeInTheDocument();
    expect(localStorage.getItem('vinculos_vista_agenda')).toBe('mes');
  });

  it('"Reservando…" de otra persona: box y rango, sin quien, y no abre detalle', async () => {
    conCliente(<Agenda rol="ADMIN" />);
    await semanaAnterior();
    expect(screen.getByText('Reservando…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reservando/ })).toBeNull();
  });

  it('Por box del PROFESIONAL: filtro por box con su horario libre y ocupado (sin quien), sus sesiones destacadas encima y apagables', async () => {
    citas = [cita('c1', '10:00', '10:50')];
    respuestas['/api/espacios/disponibilidad'] = [{ espacioId: 'b1', inicio: enChile('14:00'), fin: enChile('16:00') }];
    respuestas['/api/espacios/ocupacion'] = [
      // Bloque propio: 09-13 en b1.
      { espacio_id: 'b1', inicio: enChile('09:00'), fin: enChile('13:00') },
      // De un colega: 16-17 en b1; y otro en b2 (no se ve con b1 elegido).
      { espacio_id: 'b1', inicio: enChile('16:00'), fin: enChile('17:00') },
      { espacio_id: 'b2', inicio: enChile('16:00'), fin: enChile('17:00') },
    ];
    respuestas['/api/profesionales/{profesionalId}/bloques'] = [{ espacioId: 'b1', inicio: enChile('09:00'), fin: enChile('13:00') }];
    conCliente(<Agenda rol="PROFESIONAL" modo="box" />);
    await semanaAnterior();
    // Todos los boxes: solo sus sesiones, con el color del box; nada de ocupacion.
    expect(screen.queryByText('Ocupado')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Filtrar por box'), 'b1');
    // Grilla + leyenda.
    expect(await screen.findAllByText('Libre')).toHaveLength(2);
    expect(await screen.findAllByText('Tu horario apartado')).toHaveLength(2);
    const ocupados = screen.getAllByText('Ocupado');
    expect(ocupados).toHaveLength(1);
    expect(ocupados[0]!.parentElement!.textContent).not.toMatch(/Ana|Profesional/);
    const propia = screen.getByRole('button', { name: /10:00 Ana Demo/ });
    expect(propia.className).toMatch(/ring-2/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mis sesiones encima' }));
    expect(screen.queryByRole('button', { name: /10:00 Ana Demo/ })).toBeNull();
    expect(localStorage.getItem('vinculos_agenda_encima')).toBe('no');
  });
  it('estado con simbolo (no solo color): sin evolucion vs atendida para el tratante, con leyenda', async () => {
    citas = [cita('c1', '10:00', '10:50'), cita('c2', '12:00', '12:50')];
    respuestas['/api/citas-con-evolucion'] = ['c2'];
    conCliente(<Agenda rol="PROFESIONAL" />);
    await semanaAnterior();
    expect(await screen.findByRole('button', { name: /10:00 Ana Demo.*Sin evolución/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /12:00 Ana Demo.*Atendida/ })).toBeInTheDocument();
    const leyenda = screen.getByRole('list', { name: 'Leyenda' });
    expect(within(leyenda).getByText('Sin evolución')).toBeInTheDocument();
  });

  it('ADMIN nunca recibe el estado clinico: la sesion pasada queda "Realizada"', async () => {
    conCliente(<Agenda rol="ADMIN" />);
    await semanaAnterior();
    expect(screen.getByRole('button', { name: /10:00 Ana Demo.*Realizada/ })).toBeInTheDocument();
  });
});
