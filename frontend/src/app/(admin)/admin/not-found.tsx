import { EstadoVista } from '@/components/shared/EstadoVista';
import { ButtonLink } from '@/components/ui/ButtonLink';

export default function NoEncontrado() {
  return (
    <EstadoVista
      estado="vacio"
      titulo="Esta sección no existe o todavía no está disponible"
      mensaje="Tu sesión y tu rol siguen activos. Vuelve al inicio del panel o elige otra opción del menú."
      accion={
        <ButtonLink href="/admin" variant="secondary" icon="space_dashboard">
          Ir al inicio del panel
        </ButtonLink>
      }
    />
  );
}
