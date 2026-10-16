import { Bienvenida } from '@/components/shared/Bienvenida';
import { EstadoVista } from '@/components/shared/EstadoVista';

/** Inicio del backoffice. Estadisticas, modulos y pendientes: fase del dashboard. */
export default function InicioAdmin() {
  return (
    <>
      <Bienvenida tone="team" />
      <EstadoVista estado="vacio" titulo="Tu panel de inicio llega pronto" mensaje="Usa el menú para entrar a los módulos activos del centro." />
    </>
  );
}
