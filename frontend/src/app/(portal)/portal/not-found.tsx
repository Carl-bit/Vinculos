import { EstadoVista } from '@/components/shared/EstadoVista';
import { ButtonLink } from '@/components/ui/ButtonLink';

export default function NoEncontrado() {
  return (
    <EstadoVista
      estado="vacio"
      titulo="Esta sección no existe o todavía no está disponible"
      mensaje="Tu sesión sigue activa. Vuelve a tu cuenta o elige otra opción del menú."
      accion={
        <ButtonLink href="/portal" variant="secondary" icon="person">
          Ir a mi cuenta
        </ButtonLink>
      }
    />
  );
}
