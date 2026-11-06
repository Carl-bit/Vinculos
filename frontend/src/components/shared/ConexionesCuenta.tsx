'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';

import { Badge } from '@/components/ui/Badge';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { formatoFechaHora } from '@/lib/formato';
import { NOMBRE_ROL } from '@/lib/roles';

import { EstadoConsulta } from './EstadoVista';

type Conexion = components['schemas']['ConexionVista'];

/** La sesion actual y las mas recientes; el resto a pedido. */
const VISIBLES = 5;

/** Por que termino una conexion, en palabras del integrante. */
const MOTIVOS: Record<string, string> = {
  LOGOUT: 'Cerraste sesión',
  NUEVA_SESION: 'Se inició sesión en otro lugar',
  INACTIVIDAD: 'Se cerró por inactividad',
  CAMBIO_ROL: 'Cambiaste de rol',
  CAMBIO_CUENTA: 'Cambio en la cuenta (contraseña, rol o estado)',
  REUTILIZACION: 'Cerrada por seguridad: se reutilizó un acceso',
  NO_VIGENTE: 'Venció',
};

/**
 * Registro de conexiones de la propia cuenta (2026-11-07). La version web
 * permite una sola sesion por usuario: entrar en otro navegador cierra la
 * anterior, asi que no hay "Cerrar sesion" por dispositivo; aca se ve la
 * sesion actual y las ultimas 30 conexiones para detectar un ingreso ajeno.
 * Sin IP ni ciudad: solo navegador y sistema.
 */
export function ConexionesCuenta() {
  const [todas, setTodas] = useState(false);
  const consulta = useQuery({ queryKey: ['usuarios', 'yo', 'conexiones'], queryFn: () => datos(api.GET('/api/usuarios/yo/conexiones')) });
  return (
    <Panel
      titulo="Sesión y conexiones"
      bajada="Tu cuenta tiene una sola sesión abierta: si entras desde otro navegador o dispositivo, la anterior se cierra. Si ves una conexión que no reconoces, cambia tu contraseña."
    >
      <EstadoConsulta consulta={consulta} vacio={(l) => l.length === 0} textoVacio="Aún no hay conexiones registradas.">
        {(lista) => (
          <>
            <ul className="m-0 mt-4 flex list-none flex-col divide-y divide-neutral-200 p-0">
              {(todas ? lista : lista.slice(0, VISIBLES)).map((c, i) => (
                <Fila key={`${c.inicio}-${i}`} c={c} />
              ))}
            </ul>
            {lista.length > VISIBLES && (
              <Button variant="ghost" onClick={() => setTodas((v) => !v)} className="mt-2 !px-3 !py-1.5 !text-[13px]">
                {todas ? 'Ver menos' : `Ver las ${lista.length} últimas conexiones`}
              </Button>
            )}
          </>
        )}
      </EstadoConsulta>
    </Panel>
  );
}

function Fila({ c }: { c: Conexion }) {
  const detalle = c.activa
    ? `Desde ${formatoFechaHora(c.inicio)} · última actividad ${formatoFechaHora(c.ultimaActividad)}`
    : `${formatoFechaHora(c.inicio)} a ${formatoFechaHora(c.fin ?? c.ultimaActividad)} · ${MOTIVOS[c.motivo ?? ''] ?? 'Terminada'}`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="m-0 text-[14px] font-bold text-neutral-900">
          {c.dispositivo ?? 'Navegador no identificado'} <span className="font-semibold text-neutral-600">· {NOMBRE_ROL[c.rol]}</span>
        </p>
        <p className="m-0 mt-0.5 text-[13px] text-neutral-700">{detalle}</p>
      </div>
      {c.actual ? <Badge tono="positivo">Esta sesión</Badge> : c.activa ? <Badge tono="atencion">Abierta</Badge> : null}
    </li>
  );
}
