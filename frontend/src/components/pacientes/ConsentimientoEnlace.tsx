'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { EstadoVista } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { textoConsentimiento, VERSION_PRACTICANTE } from '@/lib/consentimientos';
import { formatoFechaHora } from '@/lib/formato';

/**
 * Enlace de consentimiento por correo (D-3), sin cuenta: consentimiento de
 * atencion, de practicante supervisado u oposicion a un cambio de
 * supervisor. Se consulta sin consumir el enlace; la respuesta es de un solo
 * uso. Explica que se acepta y que pasa si se rechaza antes de responder.
 */
export function ConsentimientoEnlace() {
  const token = useSearchParams().get('token') ?? '';
  const consulta = useQuery({
    queryKey: ['consentimiento-enlace', token],
    queryFn: () => datos(api.POST('/api/publico/consentimientos/consulta', { body: { token } })),
    enabled: !!token,
    staleTime: Infinity,
  });
  const [confirmar, setConfirmar] = useState<boolean | null>(null);
  const [resultado, setResultado] = useState<boolean | null>(null);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  if (!token) return <Vencido texto="Abre el enlace completo que te enviamos al correo." titulo="Enlace incompleto" />;
  if (consulta.isPending) return <EstadoVista estado="carga" titulo="Abriendo el consentimiento…" />;
  if (consulta.error) {
    return consulta.error instanceof ApiError && [400, 404, 409].includes(consulta.error.status) ? (
      <Vencido titulo="Este enlace ya no sirve" texto="El enlace ya se usó o venció. Si todavía tienes que responder, pide al centro un enlace nuevo." />
    ) : (
      <EstadoVista estado="error" mensaje={consulta.error instanceof ApiError ? consulta.error.message : undefined} />
    );
  }

  const c = consulta.data;
  const t = textoConsentimiento(c.tipo, { practicante: c.practicante, supervisor: c.supervisor, supervisorAnterior: c.supervisor_anterior, menor: c.menor });

  const responder = async (acepta: boolean) => {
    setEnviando(true);
    setError(undefined);
    try {
      await datos(
        api.POST('/api/publico/consentimientos/respuesta', {
          body: { token, acepta, version: acepta ? (c.tipo === 'ATENCION' ? String(c.politica_version) : VERSION_PRACTICANTE) : undefined },
        }),
      );
      setResultado(acepta);
      setConfirmar(null);
    } catch (e) {
      setConfirmar(null);
      if (e instanceof ApiError && [404, 409].includes(e.status)) setError('El enlace ya se usó o venció mientras respondías. Pide al centro uno nuevo.');
      else setError(e instanceof ApiError ? e.message : 'No pudimos registrar tu respuesta. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (resultado !== null) {
    return (
      <div role="status" className="entrada max-w-[640px] py-[clamp(32px,6vw,72px)]">
        <span className="mb-6 grid size-[60px] place-items-center rounded-full border border-accent-2-500 bg-accent-2-200 text-accent-2-700">
          <Icon name={resultado ? 'task_alt' : 'check'} size={30} />
        </span>
        <h1 className="m-0 mb-3.5 text-[clamp(30px,4vw,42px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">Registramos tu respuesta</h1>
        <p className="m-0 mb-6 text-[16.5px] leading-relaxed text-pretty text-neutral-700">{resultado ? t.acepta.consecuencia : t.rechaza.consecuencia}</p>
        <p className="m-0 text-[14px] font-semibold text-neutral-700">
          Si tienes cuenta, puedes revisar tus consentimientos en <Link href="/portal/consentimientos">Mi cuenta</Link>.
        </p>
      </div>
    );
  }

  return (
    <article className="entrada max-w-[720px] py-[clamp(28px,5vw,64px)]">
      <h1 className="m-0 mb-4 text-[clamp(30px,4vw,44px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">{t.titulo}</h1>
      <p className="m-0 mb-5 text-[16.5px] leading-relaxed text-pretty text-neutral-700">{t.resumen}</p>
      {c.menor && (
        <Aviso tono="info" icono="family_restroom" className="mb-5">
          Respondes como adulto responsable de un menor de edad. Tu respuesta queda registrada a tu nombre.
        </Aviso>
      )}
      {t.puntos.length > 0 && (
        <ul className="m-0 mb-6 flex list-none flex-col gap-2.5 p-0">
          {t.puntos.map((p) => (
            <li key={p} className="flex gap-2.5 text-[15px] leading-relaxed font-semibold text-pretty">
              <Icon name="check" size={19} className="mt-0.5 text-accent-2-700" />
              {p}
            </li>
          ))}
        </ul>
      )}
      {c.tipo === 'ATENCION' && (
        <div className="mb-6 max-h-[46vh] overflow-y-auto rounded-lg border border-divider bg-neutral-100 px-6 py-5 shadow-sm">
          <p className="m-0 mb-3 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Documento, versión {c.politica_version}</p>
          <div className="text-[15px] leading-[1.75] whitespace-pre-line text-pretty text-neutral-800">{c.politica_texto}</div>
        </div>
      )}
      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <Aviso tono="exito" icono="task_alt" titulo="Si aceptas">
          {t.acepta.consecuencia}
        </Aviso>
        <Aviso tono="advertencia" icono="info" titulo="Si no aceptas">
          {t.rechaza.consecuencia}
        </Aviso>
      </div>
      <p className="m-0 mb-5 text-[13px] font-semibold text-neutral-700">El enlace sirve una sola vez y vence el {formatoFechaHora(c.vence_en)}</p>
      {error && (
        <p role="alert" className="m-0 mb-4 text-[14px] font-bold text-accent-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button size="lg" icon="check" onClick={() => setConfirmar(true)}>
          {t.acepta.boton}
        </Button>
        <Button size="lg" variant="secondary" onClick={() => setConfirmar(false)}>
          {t.rechaza.boton}
        </Button>
      </div>

      <Modal
        abierto={confirmar !== null}
        onCerrar={() => setConfirmar(null)}
        titulo={confirmar ? '¿Confirmas que aceptas?' : '¿Confirmas que no aceptas?'}
        descripcion={confirmar ? t.acepta.consecuencia : t.rechaza.consecuencia}
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmar(null)}>
              Volver
            </Button>
            <Button variant={confirmar ? 'primary' : 'team'} loading={enviando} onClick={() => void responder(!!confirmar)}>
              {confirmar ? 'Sí, acepto' : 'Sí, no acepto'}
            </Button>
          </>
        }
      />
    </article>
  );
}

function Vencido({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div role="status" className="entrada max-w-[600px] py-[clamp(32px,6vw,80px)]">
      <span className="mb-6 grid size-[60px] place-items-center rounded-full border border-accent-2-500 bg-accent-2-200 text-accent-2-700">
        <Icon name="link_off" size={30} />
      </span>
      <h1 className="m-0 mb-3.5 text-[clamp(30px,4vw,44px)] leading-[1.02] font-black tracking-[-0.035em] text-balance">{titulo}</h1>
      <p className="m-0 text-[16.5px] leading-relaxed text-pretty text-neutral-700">{texto}</p>
    </div>
  );
}
