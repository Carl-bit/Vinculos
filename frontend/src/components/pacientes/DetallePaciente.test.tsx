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
  useMotivoConsulta: () => 'Sin ficha de ingreso registrada.',
  EvolucionesFicha: () => <p>editor-evoluciones</p>,
}));
vi.mock('./IngresoFicha', () => ({ IngresoFicha: () => <p>ingreso</p> }));
// La ficha monta todas las secciones a la vez: las de Datos tienen sus propias pruebas.
vi.mock('./AccesosTemporales', () => ({ AccesosPaciente: () => <p>accesos</p> }));
vi.mock('./AltaPaciente', () => ({ AltaPaciente: () => <p>alta</p> }));
vi.mock('./CobrosPaciente', () => ({ CobrosPaciente: () => <p>cobros</p>, usePagosPaciente: () => lista([]) }));
vi.mock('./CrearDerivacion', () => ({ CrearDerivacion: () => null }));
vi.mock('./DocumentosFicha', () => ({ DocumentosFicha: () => <p>documentos</p> }));
vi.mock('./AdjuntosFicha', () => ({ AdjuntosFicha: () => <p>adjuntos</p> }));
vi.mock('./SolicitudesEpicrisis', () => ({ SolicitudesEpicrisis: () => null }));
vi.mock('./ExportacionClinicaPendiente', () => ({ ExportacionClinicaPendiente: () => null }));

const indice = () =>
  within(screen.getByRole('navigation', { name: 'Índice de la ficha' }))
    .getAllByRole('link')
    .map((t) => t.textContent);
const montar = (rol: Rol) => render(<DetallePaciente id="pa1" rol={rol} />);

describe('Vista del paciente (03b-4.2)', () => {
  beforeEach(() => {
    vista = null;
    miId = 'p1';
    useFicha.mockReset();
    useFicha.mockImplementation((_: string, habilitado: boolean) => (habilitado ? lista({ id: 'f1', fechaApertura: '2026-01-01' }) : vacia));
  });

  it('tratante: ficha en una pagina con indice, encabezado fijo y siguiente paso', () => {
    montar('PROFESIONAL');
    // 2 sesiones sin evolucion + 1 borrador en Evoluciones; consentimiento pendiente.
    expect(indice()).toEqual(['Resumen', 'Datos', 'Sesiones', 'Evolucionespendientes: 3', 'Documentos', 'Cobros', 'Consentimientospendientes: 1']);
    const encabezado = screen.getByRole('heading', { level: 1, name: 'Ana Demo' }).closest('header')!;
    expect(encabezado.className).toMatch(/sticky/);
    expect(within(encabezado).getByText(/RUT 12\.345\.678-5/)).toBeInTheDocument();
    expect(within(encabezado).getByText(/Tratante: Profesional Uno/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copiar correo/ })).toBeInTheDocument();
    // Datos rapidos y siguiente paso van bajo el encabezado fijo (que no cambia de alto).
    const paso = screen.getByRole('status', { name: 'Siguiente paso' });
    expect(paso).toHaveTextContent('Siguiente paso');
    expect(paso).toHaveTextContent('Hay 2 sesiones realizadas sin evolución registrada.');
    expect(within(encabezado).getAllByRole('button', { name: /Registrar evolución/ })[0]).toBeEnabled();
    for (const s of ['Resumen', 'Sesiones', 'Evoluciones', 'Documentos y adjuntos', 'Consentimientos', 'Datos'])
      expect(screen.getByRole('region', { name: s })).toBeInTheDocument();
    // Sin paso intermedio: no hay boton "Abrir ficha clínica".
    expect(screen.queryByText('Abrir ficha clínica')).toBeNull();
  });

  it('?vista=evoluciones abre el editor y archivo a pantalla completa, con vuelta a la ficha', () => {
    vista = 'evoluciones';
    montar('PROFESIONAL');
    expect(screen.getByText('editor-evoluciones')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a la ficha' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sesiones' })).toBeNull();
  });

  it('ADMIN/GESTION: Sesiones, Cobros, Consentimientos y Datos; nunca contenido clinico', () => {
    miId = 'a1';
    for (const rol of ['ADMIN', 'GESTION'] as const) {
      const { unmount } = montar(rol);
      expect(indice()).toEqual(['Datos', 'Sesiones', 'Cobros', 'Consentimientospendientes: 1']);
      expect(useFicha).toHaveBeenCalledWith('pa1', false);
      expect(screen.queryByRole('region', { name: 'Resumen' })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Evoluciones' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Registrar evolución/ })).toBeNull();
      expect(screen.getByRole('status', { name: 'Siguiente paso' })).toHaveTextContent('El consentimiento informado sigue pendiente.');
      expect(screen.getByRole('heading', { level: 1, name: 'Ana Demo' }).closest('header')).not.toBeNull();
      unmount();
    }
  });
});
