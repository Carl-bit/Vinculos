'use client';

import { useState } from 'react';

import { Button, type VarianteBoton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import type { PacienteVista } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { FormularioPaciente, PacienteCreado } from './FormularioPaciente';

/** Boton "Nuevo paciente" con el alta en un modal (Dashboard y Fichas). `compacto`: boton redondo "+" (riel de pacientes). */
export function NuevoPaciente({ rol, variante = 'secondary', compacto = false }: { rol: Rol; variante?: VarianteBoton; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [creado, setCreado] = useState<PacienteVista>();
  const cerrar = () => {
    setAbierto(false);
    setCreado(undefined);
  };
  return (
    <>
      {compacto ? (
        <button
          type="button"
          aria-label="Nuevo paciente"
          onClick={() => setAbierto(true)}
          className="grid size-10 flex-none cursor-pointer place-items-center rounded-full bg-accent-700 text-neutral-100 shadow-sm transition-colors duration-200 hover:bg-accent-800"
        >
          <Icon name="add" size={22} />
        </button>
      ) : (
        <Button variant={variante} icon="person_add" onClick={() => setAbierto(true)}>
          Nuevo paciente
        </Button>
      )}
      <Modal
        abierto={abierto}
        onCerrar={cerrar}
        ancho="lg"
        titulo={creado ? 'Paciente registrado' : 'Nuevo paciente'}
        descripcion={creado ? undefined : 'Datos administrativos. El contenido clínico se registra después en la ficha.'}
      >
        {creado ? <PacienteCreado paciente={creado} onCerrar={cerrar} /> : <FormularioPaciente rol={rol} onCreado={setCreado} onCancelar={cerrar} />}
      </Modal>
    </>
  );
}
