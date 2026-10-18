'use client';

import { useState } from 'react';

import { Button, type VarianteBoton } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { PacienteVista } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { FormularioPaciente, PacienteCreado } from './FormularioPaciente';

/** Boton "Nuevo paciente" con el alta en un modal (Dashboard y Fichas). */
export function NuevoPaciente({ rol, variante = 'secondary' }: { rol: Rol; variante?: VarianteBoton }) {
  const [abierto, setAbierto] = useState(false);
  const [creado, setCreado] = useState<PacienteVista>();
  const cerrar = () => {
    setAbierto(false);
    setCreado(undefined);
  };
  return (
    <>
      <Button variant={variante} icon="person_add" onClick={() => setAbierto(true)}>
        Nuevo paciente
      </Button>
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
