'use client';

import Link from 'next/link';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import type { components } from '@/lib/api/esquema';
import { formatoFechaHora } from '@/lib/formato';
import { useBandejaAvisos } from '@/lib/mensajes';

type TipoAviso = components['schemas']['TipoNotificacion'];

/** Avisos de una cita: abren su detalle en la agenda (la referencia es la cita). */
const DE_CITA: readonly TipoAviso[] = ['CITA_CONFIRMADA', 'CITA_CANCELADA', 'CITA_REPROGRAMADA', 'SOLICITUD_HORA'];

/** Donde se resuelve cada aviso del equipo (la bandeja solo informa; la accion esta en su modulo). */
const DESTINO: Partial<Record<TipoAviso, string>> = {
  DERIVACION_OFRECIDA: '/admin/fichas?vista=derivaciones',
  DERIVACION_ACTUALIZADA: '/admin/fichas?vista=derivaciones',
  MENSAJE_PACIENTE: '/admin/mensajes?vista=pacientes',
  MENSAJE_INTERNO: '/admin/mensajes',
  SOLICITUD_HORA: '/admin/agenda?vista=pendientes',
  CIERRE_REQUERIDO: '/admin/fichas?filtro=sin-cerrar',
  POSIBLE_DUPLICADO: '/admin/fichas?filtro=duplicados',
  CONSENTIMIENTO_POR_VENCER: '/admin/fichas?vista=consentimientos',
  CITA_CONFIRMADA: '/admin/agenda',
  CITA_CANCELADA: '/admin/agenda',
  CITA_REPROGRAMADA: '/admin/agenda',
};

/**
 * Bandeja de avisos propios (registro oficial con el texto armado por la
 * plantilla). Los avisos sobre pacientes no traen contenido clinico: llevan
 * a la seccion donde se ven con los permisos del rol.
 */
export function BandejaAvisos() {
  const bandeja = useBandejaAvisos();
  return (
    <EstadoConsulta consulta={bandeja} vacio={(l) => l.length === 0} textoVacio="No tienes avisos">
      {(lista) => (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {lista.map((a) => {
            const destino = DE_CITA.includes(a.tipo) && a.referenciaId ? `/admin/agenda?cita=${a.referenciaId}` : DESTINO[a.tipo];
            return (
              <li key={a.id} className="rounded-lg border border-divider bg-neutral-100 px-[clamp(16px,2.6vw,22px)] py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="m-0 text-[15px] font-black">{a.asunto ?? 'Aviso'}</p>
                  <span className="text-[12.5px] font-semibold text-neutral-700">{formatoFechaHora(a.creadaEn)}</span>
                </div>
                {a.cuerpo && <p className="m-0 mt-2 text-[14px] font-semibold whitespace-pre-line text-pretty text-neutral-800">{a.cuerpo}</p>}
                {destino && (
                  <Link href={destino} className="mt-2.5 inline-flex min-h-10 items-center text-[13px] font-extrabold text-accent-700 hover:text-accent-800">
                    Ir a resolverlo
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </EstadoConsulta>
  );
}
