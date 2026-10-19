'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';

import { usePortal } from '@/components/shared/ContextoPortal';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Icon } from '@/components/ui/Icon';
import { Interruptor } from '@/components/ui/Interruptor';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { formatoFechaHora } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { clavesPortal, useBandeja, usePreferencias, type MensajeBandeja, type Preferencias } from '@/lib/portal';

/** Icono y destino de cada aviso (solo navegacion; el contenido ya viene armado por la API). */
const DESTINO: Partial<Record<MensajeBandeja['tipo'], { icono: Icono; href: string; accion: string }>> = {
  CITA_CONFIRMADA: { icono: 'event_available', href: '/portal#horas', accion: 'Ver mis horas' },
  CITA_CANCELADA: { icono: 'event_busy', href: '/portal#horas', accion: 'Ver mis horas' },
  CITA_REPROGRAMADA: { icono: 'event_repeat', href: '/portal#horas', accion: 'Ver mis horas' },
  RECORDATORIO_CITA: { icono: 'alarm', href: '/portal#horas', accion: 'Ver mis horas' },
  ENLACE_ONLINE: { icono: 'videocam', href: '/portal#horas', accion: 'Ver mis horas' },
  CONSENTIMIENTO_SOLICITADO: { icono: 'verified_user', href: '/portal/consentimientos', accion: 'Responder' },
  CONSENTIMIENTO_POR_VENCER: { icono: 'verified_user', href: '/portal/consentimientos', accion: 'Responder' },
  AVISO_CAMBIO_SUPERVISOR: { icono: 'supervisor_account', href: '/portal/consentimientos', accion: 'Revisar' },
  ACCESO_CLINICO_TEMPORAL: { icono: 'shield_person', href: '/portal/avisos', accion: '' },
  DOCUMENTO_CLINICO: { icono: 'description', href: '/portal/documentos', accion: 'Ver documentos' },
  PAGO_REGISTRADO: { icono: 'payments', href: '/portal/pagos', accion: 'Ver pagos' },
  BOLETA_EMITIDA: { icono: 'receipt_long', href: '/portal/pagos', accion: 'Ver pagos' },
};

/**
 * Avisos del portal: la bandeja (registro oficial de lo que el centro te
 * comunico) y las
 * preferencias de correo. Los avisos legales llegan siempre.
 */
export function AvisosPortal() {
  const bandeja = useBandeja();
  return (
    <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr))]">
      <Panel
        titulo="Bandeja de avisos"
        bajada="Todo lo que el centro te comunicó: confirmaciones, recordatorios, pagos y avisos importantes."
        className="min-w-0"
      >
        <EstadoConsulta consulta={bandeja} vacio={(d) => d.length === 0} textoVacio="No tienes avisos todavía">
          {(lista) => (
            <ul className="m-0 flex list-none flex-col gap-[11px] p-0">
              {lista.map((m) => {
                const d = DESTINO[m.tipo];
                return (
                  <li key={m.id} className="rounded-[18px] border border-divider bg-bg px-[18px] py-4">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
                      <Icon name={d?.icono ?? 'notifications'} size={18} className="text-accent-2-700" />
                      <span className="min-w-0 flex-1 text-[14px] font-black tracking-[-0.01em]">{m.asunto ?? 'Aviso del centro'}</span>
                      <span className="text-xs font-bold text-neutral-700">{formatoFechaHora(m.creadaEn)}</span>
                    </div>
                    {m.cuerpo && <p className="m-0 text-[13.5px] leading-relaxed font-medium whitespace-pre-line text-pretty text-neutral-800">{m.cuerpo}</p>}
                    {d?.accion && (
                      <Link href={d.href} className="mt-2 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-extrabold">
                        {d.accion}
                        <Icon name="arrow_forward" size={16} />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </EstadoConsulta>
      </Panel>
      <PreferenciasCorreo />
    </div>
  );
}

function PreferenciasCorreo() {
  const portal = usePortal();
  const cliente = useQueryClient();
  const prefs = usePreferencias(portal.pacienteId, portal.responsable, !portal.cargando);
  const guardar = useMutation({
    mutationFn: (p: Partial<Preferencias>) =>
      portal.responsable
        ? datos(api.PUT('/api/notificaciones/preferencias/pacientes/{pacienteId}', { params: { path: { pacienteId: portal.pacienteId! } }, body: p }))
        : datos(api.PUT('/api/notificaciones/preferencias', { body: p })),
    onSuccess: (r) => cliente.setQueryData(clavesPortal.preferencias(portal.pacienteId), r),
  });

  return (
    <Panel
      titulo="Avisos por correo"
      bajada={
        portal.responsable
          ? `Elige qué avisos de ${portal.paciente?.nombre ?? 'tu menor'} te llegan por correo.`
          : 'Elige qué avisos te llegan también por correo.'
      }
    >
      <EstadoConsulta consulta={prefs}>
        {(p) => (
          <div className="flex flex-col gap-5">
            <Interruptor
              etiqueta="Recordatorios de horas"
              descripcion="Un correo antes de cada sesión, con el enlace para confirmar o cancelar."
              activo={p.recordatorios}
              deshabilitado={guardar.isPending}
              onChange={(v) => guardar.mutate({ recordatorios: v })}
            />
            <Interruptor
              etiqueta="Avisos operativos"
              descripcion="Confirmaciones, cambios de hora, pagos, boletas y documentos disponibles."
              activo={p.avisosOperativos}
              deshabilitado={guardar.isPending}
              onChange={(v) => guardar.mutate({ avisosOperativos: v })}
            />
            {guardar.error && (
              <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos guardar el cambio.'}
              </p>
            )}
            <Aviso tono="nota" icono="gavel">
              Los avisos legales (consentimientos, accesos a tu ficha y cambios de supervisión) siempre llegan por correo y quedan en tu bandeja.
            </Aviso>
          </div>
        )}
      </EstadoConsulta>
    </Panel>
  );
}
