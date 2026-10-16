import { EstadoVista } from '@/components/shared/EstadoVista';

/** Landing del centro: entra con las paginas publicas (03b, fase del portal publico). */
export default function Inicio() {
  return <EstadoVista estado="vacio" titulo="Sitio del centro en construcción" mensaje="Si ya tienes cuenta, inicia sesión arriba a la derecha." />;
}
