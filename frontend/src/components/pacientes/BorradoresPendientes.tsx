'use client';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { useBorradores } from '@/lib/fichas';
import { formatoFechaHora } from '@/lib/formato';
import { nombresPacientes, usePacientes } from '@/lib/panel';

/**
 * Borradores de evolucion sin confirmar del usuario (C-8). Solo los ve su
 * autor; no son parte del expediente hasta que se confirman. Una baja con
 * borradores pendientes genera una alerta para administracion.
 */
export function BorradoresPendientes() {
  const borradores = useBorradores();
  const pacientes = usePacientes();
  const nombres = nombresPacientes(pacientes.data);
  return (
    <div className="flex flex-col gap-4">
      <Aviso tono="nota" icono="draft">
        Solo tú ves tus borradores. Confírmalos en el expediente: si dejas el centro con borradores pendientes, administración recibe una alerta.
      </Aviso>
      <EstadoConsulta consulta={borradores} vacio={(l) => l.length === 0} textoVacio="No tienes borradores pendientes">
        {(lista) => (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {lista.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-divider bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-4"
              >
                <div className="min-w-0 flex-[1_1_260px]">
                  <p className="m-0 text-[15px] font-black">{b.pacienteId ? (nombres.get(b.pacienteId) ?? 'Paciente') : 'Ficha sin acceso'}</p>
                  <p className="m-0 line-clamp-2 text-[13.5px] font-semibold text-neutral-800">{b.contenido}</p>
                  <p className="m-0 mt-1 text-xs font-semibold text-neutral-700">Guardado el {formatoFechaHora(b.actualizadoEn)}</p>
                </div>
                {b.pacienteId ? (
                  <ButtonLink
                    href={`/admin/fichas/${b.pacienteId}/ficha?borrador=${b.id}`}
                    variant="team"
                    icon="edit_note"
                    className="!px-4 !py-2.5 !text-[13px]"
                  >
                    Continuar
                  </ButtonLink>
                ) : (
                  <p className="m-0 max-w-[260px] text-[12.5px] font-semibold text-neutral-700">
                    Ya no tienes acceso a esta ficha (por ejemplo, tras una derivación).
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </EstadoConsulta>
    </div>
  );
}
