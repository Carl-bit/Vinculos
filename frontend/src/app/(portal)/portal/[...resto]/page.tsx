import { notFound } from 'next/navigation';

/** Ruta sin pagina dentro de la zona: el 404 se muestra con el menu y el rol activo (not-found de la zona). */
export default function SinPagina() {
  notFound();
}
