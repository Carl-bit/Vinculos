'use client';

import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { ApiError } from '@/lib/api/errores';
import { useDirectorioEquipo, useLecturasProtocolo, useMarcarProtocoloLeido, useProtocoloEquipo } from '@/lib/centro';
import { formatoFechaHora, formatoFechaLarga } from '@/lib/formato';
import { NOMBRE_ROL } from '@/lib/roles';

/**
 * Protocolo del centro en Mi perfil (diseño "Admin - Mi Perfil", 03b-4.2):
 * documento interno del equipo, versionado. "Marcar como leído" registra la
 * version leida; con una version nueva vuelve a quedar pendiente. La
 * direccion ve quien lo leyo en Configuracion > Políticas.
 */
export function ProtocoloEquipo() {
  const protocolo = useProtocoloEquipo();
  const marcar = useMarcarProtocoloLeido();
  const [abierto, setAbierto] = useState(false);
  return (
    <Panel
      titulo="Protocolo del centro"
      bajada="Reglas internas del equipo. La dirección ve quién lo leyó."
      accion={protocolo.data?.vigente ? protocolo.data.leidoEn ? <Badge tono="positivo">Leído</Badge> : <Badge tono="atencion">Pendiente</Badge> : undefined}
    >
      <div className="mt-4">
        <EstadoConsulta consulta={protocolo}>
          {(p) =>
            !p.vigente ? (
              <p className="m-0 text-[13.5px] font-semibold text-neutral-800">El centro todavía no publica su protocolo interno.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p
                  className={`m-0 overflow-y-auto rounded-[14px] border border-divider bg-bg p-4 text-[13.5px] leading-relaxed whitespace-pre-line text-neutral-800 ${
                    abierto ? 'max-h-[420px]' : 'max-h-[120px]'
                  }`}
                >
                  {p.vigente.texto}
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[12.5px] font-semibold text-neutral-700">
                    Versión {p.vigente.version} · desde {formatoFechaLarga(p.vigente.vigenteDesde)}
                  </span>
                  <Button variant="ghost" icon={abierto ? 'expand_less' : 'expand_more'} onClick={() => setAbierto(!abierto)} className="!py-2">
                    {abierto ? 'Ver menos' : 'Leer completo'}
                  </Button>
                  <span className="ml-auto">
                    {p.leidoEn ? (
                      <span className="text-[13px] font-bold text-accent-2-800">Lo marcaste como leído el {formatoFechaHora(p.leidoEn)}.</span>
                    ) : (
                      <Button variant="team" icon="task_alt" loading={marcar.isPending} onClick={() => marcar.mutate()}>
                        Marcar como leído
                      </Button>
                    )}
                  </span>
                </div>
                {marcar.error && (
                  <Aviso tono="advertencia" role="alert">
                    {marcar.error instanceof ApiError ? marcar.error.message : 'No pudimos registrar la lectura.'}
                  </Aviso>
                )}
              </div>
            )
          }
        </EstadoConsulta>
      </div>
    </Panel>
  );
}

/**
 * Registro para la direccion (ADMIN/GESTION): quien del equipo leyo la
 * version vigente del protocolo interno y quien falta.
 */
export function LecturasProtocolo() {
  const lecturas = useLecturasProtocolo(true);
  const directorio = useDirectorioEquipo(true);
  return (
    <div className="mt-4 flex flex-col gap-2.5 border-t border-divider pt-4">
      <h3 className="m-0 text-[14px] font-extrabold">Lecturas de la versión vigente</h3>
      <EstadoConsulta consulta={lecturas}>
        {(l) => {
          const equipo = (directorio.data ?? []).filter((m) => m.roles.some((r) => r !== 'PACIENTE' && r !== 'RESPONSABLE'));
          const leidas = new Map(l.map((x) => [x.usuarioId, x.leidoEn]));
          const pendientes = equipo.filter((m) => !leidas.has(m.id)).length;
          return (
            <>
              <p className="m-0 text-[13px] font-semibold text-neutral-800">
                {l.length} de {equipo.length} {equipo.length === 1 ? 'integrante lo leyó' : 'integrantes lo leyeron'}
                {pendientes > 0 ? ` · ${pendientes} pendiente${pendientes === 1 ? '' : 's'}` : ''}.
              </p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {equipo.map((m) => {
                  const leido = leidas.get(m.id);
                  return (
                    <li key={m.id} className="flex items-center gap-3 rounded-[14px] border border-divider bg-bg px-3 py-2">
                      <Avatar name={m.nombre ?? 'Integrante'} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold">{m.nombre ?? 'Integrante'}</span>
                        <span className="block text-[12px] font-semibold text-neutral-700">{m.roles.map((r) => NOMBRE_ROL[r]).join(' · ')}</span>
                      </span>
                      {leido ? (
                        <span className="text-right text-[12px] font-semibold text-accent-2-800">Leído · {formatoFechaHora(leido)}</span>
                      ) : (
                        <Badge tono="atencion">Pendiente</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          );
        }}
      </EstadoConsulta>
    </div>
  );
}
