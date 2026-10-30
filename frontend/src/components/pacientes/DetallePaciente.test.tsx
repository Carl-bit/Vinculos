import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Rol } from '@/lib/sesion';

import { DetallePaciente } from './DetallePaciente';

const lista = <T,>(data: T) => ({ isPending: false, isSuccess: true, error: null, data, refetch: vi.fn() });
const vacia = { isPending: false, isSuccess: false, error: null, data: undefined, refetch: vi.fn() };

const paciente = {
  id: 'pa1',
  nombre: 'Ana',
  apellido: 'Demo',
  rut: '123456785',
  fechaNacimiento: '1990-05-01T00:00:00.000Z',
  email: 'ana@demo.cl',
  telefono: '+56912345678',
  profesionalId: 'p1',
  tipoAtencionId: null,
  contactoEmergencia: 'Mamá +56911112222',
  bloqueoDesde: null,
  posibleDuplicado: false,
  traidoPorCentro: false,
};
let vista: string | null = null;
let miId = 'p1';
const useFicha = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(vista ? { vista } : {}),
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQuery: () => vacia,
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/consultas', () => ({ useMiCuenta: () => lista({ id: miId }), useModulos: () => lista({ activos: ['FICHAS', 'AGENDA', 'COBROS'] }) }));
vi.mock('@/lib/fichas', () => ({ useBorradores: () => lista([{ id: 'b1' }]), useIngresos: () => lista([]) }));
vi.mock('@/lib/panel', async (original) => ({
  ...(await original<typeof import('@/lib/panel')>()),
  usePaciente: () => lista(paciente),
  useFicha: (id: string, habilitado: boolean) => useFicha(id, habilitado),
  useCitas: () => lista([]),
  useEquipoAgenda: () => lista([{ id: 'p1', nombre: 'Profesional Uno' }]),
  useTiposAtencion: () => lista([]),
  useAdultosResponsables: () => lista([]),
  useEstadoFichas: () => lista([{ paciente_id: 'pa1', alta_en: null, sesiones_sin_cerrar: 2, ultima_sesion: null, proxima_sesion: null }]),
  useEvoluciones: () => lista([]),
}));
// Secciones: sus propias pruebas; aca solo importa cuales se montan.
vi.mock('./SeccionesPaciente', () => ({
  AccesoFicha: () => <p>acceso-ficha</p>,
  AdultosResponsables: () => <p>adultos</p>,
  ConsentimientoPaciente: () => <p>consentimiento</p>,
  CuentaPaciente: () => <p>cuenta</p>,
  DerivacionRecibida: () => null,
  HistorialSesiones: () => <p>historial</p>,
  IndicacionesPaciente: () => <p>indicaciones</p>,
  OrigenPaciente: () => <p>origen</p>,
  useConsentimientoAtencion: () => ({ vigente: lista({ version: 2 }), aceptaciones: lista([]), alDia: false }),
}));
vi.mock('./FichaClinica', () => ({
  ContactoEmergencia: () => <p>contacto</p>,
  ConversacionesCaso: () => null,
  EvolucionesFicha: () => <p>evoluciones</p>,
}));
vi.mock('./CobrosPaciente', () => ({ CobrosPaciente: () => <p>cobros</p>, usePagosPaciente: () => lista([]) }));
vi.mock('./CrearDerivacion', () => ({ CrearDerivacion: () => null }));
vi.mock('./DocumentosFicha', () => ({ DocumentosFicha: () => <p>documentos</p> }));
vi.mock('./AdjuntosFicha', () => ({ AdjuntosFicha: () => <p>adjuntos</p> }));
vi.mock('./SolicitudesEpicrisis', () => ({ SolicitudesEpicrisis: () => null }));
vi.mock('./ExportacionClinicaPendiente', () => ({ ExportacionClinicaPendiente: () => null }));

const pestanas = () =>
  within(screen.getByRole('tablist', { name: 'Secciones del paciente' }))
    .getAllByRole('tab')
    .map((t) => t.textContent);
const montar = (rol: Rol) => render(<DetallePaciente id="pa1" rol={rol} />);

describe('Vista del paciente (03b-4.2)', () => {
  beforeEach(() => {
    vista = null;
    miId = 'p1';
    useFicha.mockReset();
    useFicha.mockImplementation((_: string, habilitado: boolean) => (habilitado ? lista({ id: 'f1', fechaApertura: '2026-01-01' }) : vacia));
  });

  it('tratante: pestañas clinicas, encabezado de identidad fijo, avisos y panel lateral', () => {
    montar('PROFESIONAL');
    expect(pestanas()).toEqual(['Sesiones', 'Evoluciones', 'Ingreso', 'Documentos y adjuntos', 'Cobros', 'Consentimientos', 'Datos']);
    const encabezado = screen.getByRole('heading', { level: 1, name: 'Ana Demo' }).closest('header')!;
    expect(encabezado.className).toMatch(/sticky/);
    expect(within(encabezado).getByText(/RUT 12\.345\.678-5/)).toBeInTheDocument();
    expect(within(encabezado).getByText(/Tratante: Profesional Uno/)).toBeInTheDocument();
    expect(within(encabezado).getByRole('button', { name: /Copiar correo/ })).toBeInTheDocument();
    const avisos = within(encabezado).getByRole('list', { name: 'Avisos de acción' });
    expect(within(avisos).getByText('Consentimiento pendiente')).toBeInTheDocument();
    expect(within(avisos).getByText('2 sesiones sin evolución')).toBeInTheDocument();
    expect(within(avisos).getByText('Borrador sin confirmar')).toBeInTheDocument();
    expect(within(encabezado).getByRole('button', { name: /Registrar evolución/ })).toBeEnabled();
    expect(screen.getByRole('complementary', { name: 'Resumen clínico' })).toBeInTheDocument();
    // Sin paso intermedio: no hay boton "Abrir ficha clínica".
    expect(screen.queryByText('Abrir ficha clínica')).toBeNull();
  });

  it('?vista= de la antigua pagina /ficha llega a la pestaña equivalente', () => {
    vista = 'adjuntos';
    montar('PROFESIONAL');
    expect(screen.getByRole('tab', { name: 'Documentos y adjuntos' })).toHaveAttribute('aria-selected', 'true');
  });

  it('ADMIN/GESTION: Sesiones, Cobros, Consentimientos y Datos; nunca contenido clinico', () => {
    miId = 'a1';
    for (const rol of ['ADMIN', 'GESTION'] as const) {
      const { unmount } = montar(rol);
      expect(pestanas()).toEqual(['Sesiones', 'Cobros', 'Consentimientos', 'Datos']);
      expect(useFicha).toHaveBeenCalledWith('pa1', false);
      expect(screen.queryByRole('complementary', { name: 'Resumen clínico' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Registrar evolución/ })).toBeNull();
      expect(screen.getByRole('heading', { level: 1, name: 'Ana Demo' }).closest('header')).not.toBeNull();
      unmount();
    }
  });
});
