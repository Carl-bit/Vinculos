import { Bienvenida } from '@/components/shared/Bienvenida';
import { EstadoVista } from '@/components/shared/EstadoVista';

/** Inicio del portal del paciente. Horas, datos y mensajes: fase del portal. */
export default function InicioPortal() {
  return (
    <>
      <Bienvenida tone="patient" />
      <EstadoVista estado="vacio" titulo="Tus horas aparecerán aquí" />
    </>
  );
}
