import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { semanaChile } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { CalendarioAgenda } from './CalendarioAgenda';

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
let filtroProfesional: string | null = null;
vi.mock('@/components/shared/EquipoActivo', () => ({ useEquipoActivo: () => ({ profesionalId: filtroProfesional, setProfesionalId: vi.fn() }) }));
vi.mock('@/lib/consultas', () => ({
  useMiCuenta: () => lista({ id: 'p1' }),
  useModulos: () => lista({ activos: ['AGENDA', 'FICHAS', 'COBROS'] }),
}));
let citas: unknown[] = [];
vi.mock('@/lib/panel', async (original) => ({
  ...(await original<typeof import('@/lib/panel')>()),
  // El panel pide las de pago pendiente con su propio filtro: vacias salvo que la prueba las use.
  useCitas: (f: { estado?: string }) => lista(f.estado ? [] : citas),
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

const elegirHora = vi.fn();
function Agenda({ rol }: { rol: Rol }) {
  return <CalendarioAgenda rol={rol} onElegir={vi.fn()} onAgendar={vi.fn()} onElegirHora={elegirHora} onVerPendientes={vi.fn()} />;
}
/** Elige un box en el panel lateral (reemplaza la pestaña "Por box"). */
const elegirBox = (nombre: string) => userEvent.click(screen.getByRole('button', { name: new RegExp(`^${nombre}`) }));
const conCliente = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

/** La agenda abre en la semana actual: vuelve a la semana del martes de prueba. */
async function semanaAnterior() {
  await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
}

describe('CalendarioAgenda (03b-4.2)', () => {
  beforeEach(() => {
    localStorage.clear();
    filtroProfesional = null;
    citas = [cita('c1', '10:00', '10:50')];
    for (const k of Object.keys(respuestas)) delete respuestas[k];
  });

  it('grilla de 08:00 a 24:00 estirada al alto: posicion y alto en %; sin tarjetas "Libre" fuera de un box; resumen por modalidad', async () => {
    conCliente(<Agenda rol="ADMIN" />);
    await semanaAnterior();
    const caja = screen.getByRole('button', { name: /10:00 Ana Demo/ }).parentElement!;
    // 10:00 = 2 h de 16; 50 min.
    expect(parseFloat(caja.style.top)).toBeCloseTo((120 / 960) * 100);
    expect(parseFloat(caja.style.height)).toBeCloseTo((50 / 960) * 100);
    expect(screen.getByText('08:00')).toBeInTheDocument();
    expect(screen.queryByText('07:00')).toBeNull();
    expect(screen.queryByText('Libre')).toBeNull();
    expect(screen.getAllByText('1 presencial · 0 online').length).toBeGreaterThan(0);
    // Presencial con el color de su modalidad (diseño Opcion A).
    expect(screen.getByRole('button', { name: /10:00 Ana Demo/ }).className).toMatch(/bg-presencial-200/);
  });

  it('Dia | Semana | Mes con Anterior, Hoy y Siguiente', async () => {
    conCliente(<Agenda rol="ADMIN" />);
    const hoy = screen.getByRole('button', { name: 'Hoy' });
    expect(hoy).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(hoy).toBeEnabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Día' }));
    expect(screen.getByRole('button', { name: 'Día anterior' })).toBeInTheDocument();
    expect(localStorage.getItem('vinculos_vista_agenda')).toBe('dia');
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

  it('Box elegido en el panel (PROFESIONAL): su horario libre y ocupado (sin quien), sus sesiones encima y elevadas', async () => {
    citas = [cita('c1', '10:00', '10:50')];
    respuestas['/api/espacios/disponibilidad'] = [{ espacioId: 'b1', inicio: enChile('14:00'), fin: enChile('16:00') }];
    respuestas['/api/espacios/ocupacion'] = [
      // Bloque propio: 09-13 en b1.
      { espacio_id: 'b1', inicio: enChile('09:00'), fin: enChile('13:00') },
      // De un colega: 16-17 en b1; y otro en b2 (no se ve con b1 elegido).
      { espacio_id: 'b1', inicio: enChile('16:00'), fin: enChile('17:00') },
      { espacio_id: 'b2', inicio: enChile('16:00'), fin: enChile('17:00') },
    ];
    respuestas['/api/espacios/sesiones'] = [
      { espacio_id: 'b1', inicio: enChile('10:00'), fin: enChile('10:50') },
      { espacio_id: 'b1', inicio: enChile('16:00'), fin: enChile('16:50') },
    ];
    respuestas['/api/profesionales/{profesionalId}/bloques'] = [{ espacioId: 'b1', inicio: enChile('09:00'), fin: enChile('13:00') }];
    conCliente(<Agenda rol="PROFESIONAL" />);
    await semanaAnterior();
    // Sin box elegido: solo sus sesiones; nada de ocupacion.
    expect(screen.queryByText('Ocupado')).toBeNull();
    await elegirBox('Box 1');
    // Grilla + leyenda.
    expect(await screen.findAllByText('Libre')).toHaveLength(1);
    expect(within(screen.getByRole('list', { name: 'Leyenda' })).getByText('Horas libres de Box 1')).toBeInTheDocument();
    // El bloque propio se corta bajo la sesion de las 10:00: dos tramos + leyenda.
    expect(await screen.findAllByText('Tu horario apartado')).toHaveLength(3);
    const ocupados = screen.getAllByText('Ocupado');
    expect(ocupados).toHaveLength(1);
    expect(ocupados[0]!.parentElement!.textContent).not.toMatch(/Ana|Profesional/);
    const propia = screen.getByRole('button', { name: /10:00 Ana Demo/ });
    expect(propia.className).toMatch(/shadow-md/);
    // Otro clic en el box lo suelta.
    await elegirBox('Box 1');
    expect(screen.queryByText('Ocupado')).toBeNull();
  });

  it('Box elegido por ADMIN: lo apartado muestra quien lo aparto', async () => {
    respuestas['/api/espacios/ocupacion'] = [{ espacio_id: 'b1', inicio: enChile('15:00'), fin: enChile('18:00') }];
    respuestas['/api/espacios/sesiones'] = [{ espacio_id: 'b1', inicio: enChile('16:00'), fin: enChile('16:50') }];
    respuestas['/api/espacios/bloques'] = [{ profesionalId: 'p2', espacioId: 'b1', inicio: enChile('15:00'), fin: enChile('18:00') }];
    conCliente(<Agenda rol="ADMIN" />);
    await semanaAnterior();
    await elegirBox('Box 1');
    expect((await screen.findByText('Ocupado')).parentElement).toHaveTextContent('Profesional Dos');
  });

  it('Box elegido por ADMIN: una sesion del box va como carta, no duplicada como "Ocupado"', async () => {
    citas = [cita('c1', '10:00', '10:50', { profesionalId: 'p2' })];
    respuestas['/api/espacios/ocupacion'] = [{ espacio_id: 'b1', inicio: enChile('10:00'), fin: enChile('11:00') }];
    respuestas['/api/espacios/sesiones'] = [{ espacio_id: 'b1', inicio: enChile('10:00'), fin: enChile('10:50') }];
    respuestas['/api/espacios/bloques'] = [{ profesionalId: 'p2', espacioId: 'b1', inicio: enChile('10:00'), fin: enChile('11:00') }];
    conCliente(<Agenda rol="ADMIN" />);
    await semanaAnterior();
    await elegirBox('Box 1');
    expect(await screen.findByRole('button', { name: /10:00 Ana Demo/ })).toBeInTheDocument();
    expect(screen.queryByText('Ocupado')).toBeNull();
  });

  it('Box elegido por ADMIN con profesional elegido: lo suyo no es "Ocupado"; la sesion de otro si, una por una', async () => {
    filtroProfesional = 'p1';
    respuestas['/api/espacios/ocupacion'] = [
      { espacio_id: 'b1', inicio: enChile('09:00'), fin: enChile('13:00') },
      { espacio_id: 'b1', inicio: enChile('15:00'), fin: enChile('19:00') },
    ];
    respuestas['/api/espacios/sesiones'] = [
      { espacio_id: 'b1', inicio: enChile('10:00'), fin: enChile('10:50') },
      { espacio_id: 'b1', inicio: enChile('15:00'), fin: enChile('15:50') },
      { espacio_id: 'b1', inicio: enChile('17:00'), fin: enChile('17:50') },
    ];
    respuestas['/api/espacios/bloques'] = [
      { profesionalId: 'p1', espacioId: 'b1', inicio: enChile('09:00'), fin: enChile('13:00') },
      { profesionalId: 'p2', espacioId: 'b1', inicio: enChile('15:00'), fin: enChile('19:00') },
    ];
    conCliente(<Agenda rol="ADMIN" />);
    await semanaAnterior();
    await elegirBox('Box 1');
    const ocupadas = await screen.findAllByText('Ocupado');
    expect(ocupadas).toHaveLength(2);
    // Los nombres salen de los bloques del centro, que llegan en su propia consulta.
    await waitFor(() => expect(screen.getAllByText('Ocupado')[0]!.parentElement).toHaveTextContent('Profesional Dos'));
    await waitFor(() => expect(screen.getAllByText('Horario apartado').at(-1)!.parentElement).toHaveTextContent('Profesional Uno'));
  });

  it('Box a futuro: la hora libre abre agendar presencial y la sesion de otro no se puede elegir', async () => {
    const dia = semanaChile(1).dias[1]!;
    const en = (h: string) => new Date(`${dia}T${h}:00-03:00`).toISOString();
    citas = [];
    respuestas['/api/espacios/disponibilidad'] = [{ espacioId: 'b1', inicio: en('13:00'), fin: en('15:00') }];
    respuestas['/api/espacios/ocupacion'] = [{ espacio_id: 'b1', inicio: en('15:00'), fin: en('19:00') }];
    respuestas['/api/espacios/sesiones'] = [{ espacio_id: 'b1', inicio: en('15:00'), fin: en('15:50') }];
    conCliente(<Agenda rol="PROFESIONAL" />);
    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    await elegirBox('Box 1');
    await userEvent.click(await screen.findByRole('button', { name: 'Agendar sesión a las 14:00, Box 1' }));
    expect(elegirHora).toHaveBeenCalledWith(expect.objectContaining({ espacioId: 'b1', profesionalId: 'p1', apartar: true }));
    expect(screen.queryByRole('button', { name: /^Agendar sesión a las 15:00/ })).toBeNull();
    expect(screen.getAllByText('Ocupado')).toHaveLength(1);
  });

  it('hora vacia a futuro agenda online (sin box); el filtro Presencial la oculta junto a las sesiones online', async () => {
    const dia = semanaChile(1).dias[2]!;
    const en = (h: string) => new Date(`${dia}T${h}:00-03:00`).toISOString();
    citas = [
      cita('c1', '10:00', '10:50', { inicio: en('10:00'), fin: en('10:50') }),
      cita('c2', '12:00', '12:50', { inicio: en('12:00'), fin: en('12:50'), modalidad: 'ONLINE', espacioId: null }),
    ];
    conCliente(<Agenda rol="PROFESIONAL" />);
    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
    expect(screen.getByRole('button', { name: /12:00 Ana Demo, Online/ }).className).toMatch(/bg-online-100/);
    // La hora con sesion no se ofrece: 10:00 queda en los otros 4 dias de la semana, no en el miercoles.
    expect(screen.queryAllByRole('button', { name: 'Agendar sesión online a las 10:00' })).toHaveLength(4);
    await userEvent.click(screen.getAllByRole('button', { name: 'Agendar sesión online a las 16:00' })[0]!);
    expect(elegirHora).toHaveBeenLastCalledWith(expect.objectContaining({ espacioId: null, nombreBox: 'Online', profesionalId: 'p1', apartar: false }));
    expect(screen.getByText(/En la semana: 1 presencial · 1 online/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Presencial', pressed: false }));
    expect(screen.queryByRole('button', { name: /12:00 Ana Demo/ })).toBeNull();
    expect(screen.queryAllByRole('button', { name: /Agendar sesión online/ })).toHaveLength(0);
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
