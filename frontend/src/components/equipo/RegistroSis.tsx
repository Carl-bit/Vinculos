'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge, type TonoBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoFecha } from '@/lib/formato';
import { useEquipoAgenda } from '@/lib/panel';

type RegistroSis = components['schemas']['RegistroSisVista'];
type RegistroPublico = components['schemas']['RegistroSisPublico'];

/** Buscador publico del Registro Nacional de Prestadores Individuales. */
export const URL_RNPI = 'https://rnpi.superdesalud.gob.cl/';

const ESTADO: Record<RegistroSis['estado'], { texto: string; tono: TonoBadge }> = {
  NO_INFORMADO: { texto: 'Sin registro informado', tono: 'neutro' },
  PENDIENTE: { texto: 'Pendiente de verificación', tono: 'atencion' },
  VERIFICADO_AUTOMATICO: { texto: 'Verificado en la Superintendencia', tono: 'positivo' },
  VERIFICADO_MANUAL: { texto: 'Verificado por el centro', tono: 'positivo' },
  NO_COINCIDE: { texto: 'No coincide', tono: 'atencion' },
};

const textoVerificado = (r: { estado: string; verificado_en?: string | null; verificadoEn?: string | null }) => {
  const fecha = r.verificado_en ?? r.verificadoEn;
  return r.estado === 'VERIFICADO_AUTOMATICO' && fecha ? `Verificado el ${formatoFecha(fecha)}` : 'Verificado por el centro';
};

/**
 * Insignia del equipo publico y del perfil completo (03b-4.2): "Registro SIS
 * N.º X" con su estado y enlace al buscador del RNPI. Sin registro
 * verificado no se muestra (la API solo entrega los verificados).
 */
export function InsigniaRegistroSis({ registro }: { registro: RegistroPublico | null }) {
  if (!registro) return null;
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-semibold text-neutral-800">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-2-500 bg-accent-2-100 px-2.5 py-1 font-extrabold text-accent-2-800">
        <Icon name="verified" size={15} />
        Registro SIS N.º {registro.numero}
      </span>
      <span>{textoVerificado(registro)}</span>
      <a
        href={URL_RNPI}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 font-extrabold text-accent-2-800 underline underline-offset-2"
      >
        Consultar en la Superintendencia
        <Icon name="open_in_new" size={14} label="(se abre en otra pestaña)" />
      </a>
    </p>
  );
}

/**
 * Registro SIS en vistas internas (Mi perfil y ficha del integrante). El
 * profesional informa su numero; el ADMIN verifica (consulta automatica
 * desde el servidor o manual con el respaldo de la trayectoria). Los
 * practicantes no tienen registro propio: se muestra su supervisor.
 */
export function RegistroSisPanel({
  profesionalId,
  practicante,
  propio,
  admin,
}: {
  profesionalId: string;
  practicante: boolean;
  propio: boolean;
  admin: boolean;
}) {
  if (practicante) return <SupervisadoPor practicanteId={profesionalId} />;
  return <RegistroProfesional profesionalId={profesionalId} propio={propio} admin={admin} />;
}

function SupervisadoPor({ practicanteId }: { practicanteId: string }) {
  const supervisiones = useQuery({ queryKey: ['equipo', 'supervisiones'], queryFn: () => datos(api.GET('/api/supervisiones')) });
  const equipo = useEquipoAgenda();
  const vigente = (supervisiones.data ?? []).find((s) => s.practicanteId === practicanteId && !s.hasta);
  const nombre = vigente ? (equipo.data?.find((m) => m.id === vigente.supervisorId)?.nombre ?? 'un profesional del centro') : null;
  return (
    <Panel titulo="Registro en la Superintendencia" nivel={2}>
      <p className="m-0 flex items-center gap-2 text-[14px] font-bold">
        <Icon name="supervisor_account" size={18} className="text-accent-2-700" />
        {supervisiones.isPending ? '…' : nombre ? `Practicante supervisado por ${nombre}` : 'Practicante sin supervisor asignado'}
      </p>
    </Panel>
  );
}

function RegistroProfesional({ profesionalId, propio, admin }: { profesionalId: string; propio: boolean; admin: boolean }) {
  const cliente = useQueryClient();
  const clave = ['equipo', 'registro-sis', profesionalId];
  const registro = useQuery({
    queryKey: clave,
    queryFn: () => datos(api.GET('/api/profesionales/{id}/registro-sis', { params: { path: { id: profesionalId } } })),
  });
  const [numero, setNumero] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [manual, setManual] = useState(false);
  const listo = (r: RegistroSis) => {
    cliente.setQueryData(clave, r);
    setMensaje(r.motivo ?? null);
    setError(undefined);
  };
  const fallo = (e: unknown) => setError(e instanceof ApiError ? e.message : 'No pudimos completar la verificación.');
  const informar = useMutation({
    mutationFn: (n: string | null) => datos(api.PUT('/api/profesionales/yo/registro-sis', { body: { numero: n } })),
    onSuccess: (r) => {
      setNumero('');
      listo(r);
    },
    onError: fallo,
  });
  const verificar = useMutation({
    mutationFn: () => datos(api.POST('/api/profesionales/{id}/registro-sis/verificacion', { params: { path: { id: profesionalId } } })),
    onSuccess: listo,
    onError: fallo,
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const limpio = numero.replace(/\D/g, '');
    if (!limpio) {
      setError('Ingresa el número de registro (solo dígitos).');
      return;
    }
    informar.mutate(limpio);
  };

  return (
    <Panel
      titulo="Registro en la Superintendencia"
      nivel={2}
      bajada="Número de registro de prestador individual (RNPI). Verificado, aparece en el perfil público."
    >
      <EstadoConsulta consulta={registro}>
        {(r) => (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {r.numero && <span className="text-[16px] font-black tabular-nums">N.º {r.numero}</span>}
              <Badge tono={ESTADO[r.estado].tono}>{ESTADO[r.estado].texto}</Badge>
              {(r.estado === 'VERIFICADO_AUTOMATICO' || r.estado === 'VERIFICADO_MANUAL') && (
                <span className="text-[12.5px] font-semibold text-neutral-700">{textoVerificado(r)}</span>
              )}
            </div>
            {r.tituloHabilitante && (
              <p className="m-0 text-[13px] font-semibold text-neutral-800">
                Título habilitante: {r.tituloHabilitante}
                {r.institucion ? ` · ${r.institucion}` : ''}
              </p>
            )}
            {mensaje && <Aviso tono="nota">{mensaje}</Aviso>}
            {r.verificacionSimulada && (admin || propio) && (
              <p className="m-0 text-[12px] font-semibold text-neutral-700">
                Verificación automática en modo demostración: el centro aún no tiene la clave de la Superintendencia.
              </p>
            )}
            {propio && (
              <form onSubmit={enviar} noValidate className="flex flex-wrap items-end gap-2.5">
                <div className="w-full max-w-[220px]">
                  <Field label={r.numero ? 'Cambiar número' : 'Número de registro'}>
                    {(p) => <Input {...p} inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Ej.: 123456" />}
                  </Field>
                </div>
                <Button type="submit" variant="team" icon="save" loading={informar.isPending}>
                  Guardar y verificar
                </Button>
                {r.numero && (
                  <Button variant="ghost" onClick={() => informar.mutate(null)}>
                    Quitar
                  </Button>
                )}
              </form>
            )}
            {admin && r.numero && (
              <div className="flex flex-wrap gap-2.5">
                <Button variant="secondary" icon="refresh" loading={verificar.isPending} onClick={() => verificar.mutate()}>
                  Verificar ahora
                </Button>
                <Button variant="secondary" icon="verified_user" onClick={() => setManual(true)}>
                  Verificar manualmente
                </Button>
              </div>
            )}
            {error && (
              <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
                {error}
              </p>
            )}
            <a
              href={URL_RNPI}
              target="_blank"
              rel="noopener noreferrer"
              className="self-start text-[12.5px] font-extrabold text-accent-700 underline underline-offset-2"
            >
              Buscador público del RNPI
            </a>
            {admin && (
              <VerificacionManual
                abierto={manual}
                profesionalId={profesionalId}
                onListo={(x) => {
                  setManual(false);
                  if (x) listo(x);
                }}
              />
            )}
          </div>
        )}
      </EstadoConsulta>
    </Panel>
  );
}

/** ADMIN: verificacion manual con el respaldo de la trayectoria (sin apikey o con el RNPI caido). */
function VerificacionManual({ abierto, profesionalId, onListo }: { abierto: boolean; profesionalId: string; onListo: (r?: RegistroSis) => void }) {
  const [titulo, setTitulo] = useState('');
  const [institucion, setInstitucion] = useState('');
  const [error, setError] = useState<string>();
  const guardar = useMutation({
    mutationFn: (coincide: boolean) =>
      datos(
        api.POST('/api/profesionales/{id}/registro-sis/verificacion-manual', {
          params: { path: { id: profesionalId } },
          body: { coincide, tituloHabilitante: titulo.trim(), institucion: institucion.trim() },
        }),
      ),
    onSuccess: (r) => onListo(r),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar la verificación.'),
  });
  const valido = titulo.trim().length >= 2 && institucion.trim().length >= 2;
  return (
    <Modal
      abierto={abierto}
      onCerrar={() => onListo()}
      titulo="Verificar registro a mano"
      descripcion="Compara el número con el buscador del RNPI y el respaldo del título. Queda registrado quién verificó y cuándo."
      acciones={
        <>
          <Button variant="ghost" onClick={() => guardar.mutate(false)} disabled={!valido} loading={guardar.isPending && guardar.variables === false}>
            No coincide
          </Button>
          <Button
            variant="team"
            icon="verified_user"
            onClick={() => guardar.mutate(true)}
            disabled={!valido}
            loading={guardar.isPending && guardar.variables === true}
          >
            Coincide
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Título habilitante" required>
          {(p) => <Input {...p} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Psicólogo" />}
        </Field>
        <Field label="Institución" required>
          {(p) => <Input {...p} value={institucion} onChange={(e) => setInstitucion(e.target.value)} />}
        </Field>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
