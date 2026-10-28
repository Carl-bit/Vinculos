import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errores';
import type { PerfilProfesional } from '@/lib/equipo';

import { FormularioPerfil } from './FormularioPerfil';

const llamadas: string[] = [];
const fallaCuenta = { activa: false };
vi.mock('@/lib/api/cliente', () => ({
  api: {
    PATCH: vi.fn(async (ruta: string) => {
      llamadas.push(`PATCH ${ruta}`);
      if (fallaCuenta.activa) throw new ApiError(409, { mensaje: 'El correo ya está en uso.' });
      return {};
    }),
    PUT: vi.fn(async (ruta: string) => {
      llamadas.push(`PUT ${ruta}`);
      return {};
    }),
  },
  datos: (p: Promise<unknown>) => p,
}));

const perfil = {
  especialidad: 'Psicología clínica',
  modalidad: 'MIXTA',
  enfoques: [],
  idiomas: [],
  convenios: [],
  perfilPublico: false,
} as unknown as PerfilProfesional;

function montar() {
  const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <FormularioPerfil modo="propio" profesionalId="p1" perfil={perfil} puedeFoto={false} cuenta={{ nombre: 'Ana', email: 'ana@centro.cl', telefono: '' }} />
    </QueryClientProvider>,
  );
}

describe('Mi perfil: un formulario con barra fija (03b-4.1, pendiente 7)', () => {
  beforeEach(() => {
    llamadas.length = 0;
    fallaCuenta.activa = false;
  });

  it('la barra se activa con cambios y "Descartar cambios" vuelve a lo guardado', async () => {
    montar();
    const guardar = screen.getByRole('button', { name: 'Guardar mi perfil' });
    expect(guardar).toBeDisabled();
    await userEvent.type(screen.getAllByLabelText(/^Nombre/)[0]!, ' María');
    expect(guardar).toBeEnabled();
    expect(screen.getByText('Tienes cambios sin guardar.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    expect(screen.getAllByLabelText(/^Nombre/)[0]!).toHaveValue('Ana');
    expect(guardar).toBeDisabled();
  });

  it('guarda la cuenta y despues el perfil, en ese orden', async () => {
    montar();
    await userEvent.type(screen.getAllByLabelText(/^Nombre/)[0]!, ' María');
    await userEvent.type(screen.getByLabelText(/^Especialidad/), ' adultos');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar mi perfil' }));
    expect(await screen.findByText(/Perfil guardado/)).toBeInTheDocument();
    expect(llamadas).toEqual(['PATCH /api/usuarios/yo', 'PUT /api/profesionales/yo/perfil']);
  });

  it('si la cuenta falla, el error queda en sus datos y el perfil no se envia', async () => {
    fallaCuenta.activa = true;
    montar();
    await userEvent.type(screen.getAllByLabelText(/^Nombre/)[0]!, ' María');
    await userEvent.type(screen.getByLabelText(/^Especialidad/), ' adultos');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar mi perfil' }));
    expect(await screen.findByText('El correo ya está en uso.')).toBeInTheDocument();
    expect(llamadas).toEqual(['PATCH /api/usuarios/yo']);
  });
});
