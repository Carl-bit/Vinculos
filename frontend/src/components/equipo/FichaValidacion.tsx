'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useMiCuenta } from '@/lib/consultas';
import {
  NOMBRE_MODALIDAD,
  NOMBRE_ROL,
  TIPO_TRAYECTORIA,
  useDatosPrivados,
  useEspecialidades,
  useEspecialidadesDe,
  usePerfilProfesional,
  useTarifas,
  useTiposDeProfesional,
  useTrayectoria,
  type Cuenta,
  type PerfilProfesional,
  type Trayectoria,
} from '@/lib/equipo';
import { formatoClp, formatoFecha, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { useEstadoFichas, useTiposAtencion } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';
import { ESTADO_INTEGRANTE, alertasPerfil, type Check, type EstadoIntegrante } from '@/lib/validacionEquipo';
import { tarifasVigentes } from '@/lib/vistaPreviaPerfil';

import { AgendaProfesional } from '@/components/shared/AgendaProfesional';

import { DocumentosPracticante } from './DocumentosPracticante';
import { AsignarTipos, CuentaIntegrante, HistorialTarifas, ResenasPublicas } from './FichaIntegrante';
import { AccionPracticante } from './PracticantesEquipo';
import { URL_RNPI, VerificacionManual } from './RegistroSis';
import { RespaldoTitulo } from './RespaldoTitulo';

export interface Integrante {
  id: string;
  nombre: string;
  roles: Rol[];
  activo: boolean;
}

/** Campos del perfil publico que se pueden pedir corregir (la foto solo la cambia el profesional). */
const CAMPO = {
  nombre_publico: 'Nombre público',
  especialidad: 'Especialidad',
  cita_destacada: 'Frase destacada',
  bio: 'Sobre mí',
  enfoques: 'Enfoques',
  foto_url: 'Foto',
} as const;
type CampoPerfil = keyof typeof CAMPO;
const valorCampo = (p: PerfilProfesional, c: CampoPerfil) =>
  ({
    nombre_publico: p.nombrePublico ?? '',
    especialidad: p.especialidad,
    cita_destacada: p.citaDestacada ?? '',
    bio: p.bio ?? '',
    enfoques: p.enfoques.join(', '),
    foto_url: '',
  })[c];
const ACUERDO = { DIRECTO: 'A · cobra el profesional', CENTRO: 'B · cobra el centro', MIXTO: 'C · mixto' } as const;
/** Boton compacto dentro de las filas (el sistema no tiene talla sm). */
const CHICO = '!min-h-9 !px-3 !py-1.5 !text-[12.5px]';
const textoError = (e: unknown, base: string) => (e instanceof ApiError ? e.message : base);

/**
 * Conversacion general con un integrante (Mensajes): "Escribirle" y "Pedir
 * una correccion". Es mensajeria interna: no se nombra a pacientes. No envia
 * correo (la mensajeria interna no notifica por correo).
 */
async function escribir(participante: string, asunto: string, contenido: string) {
  const hilo = await datos(api.POST('/api/hilos', { body: { tipo: 'GENERAL', asunto, participantes: [participante] } }));
  await datos(api.POST('/api/hilos/{id}/mensajes', { params: { path: { id: hilo.id } }, body: { contenido } }));
  return hilo.id;
}

/**
 * Ficha del integrante con lista de validacion (diseño "Equipo del centro,
 * version 1"): cabecera con estado, validacion paso a paso, perfil publico
 * en solo lectura (lo edita el profesional en Mi perfil; la cuenta madre pide
 * correcciones), trabajo con pacientes (solo estado administrativo),
 * administrativo y la cuenta. Escribe solo ADMIN; GESTION ve el estado.
 */
export function FichaValidacion({
  miembro,
  cuenta,
  rol,
  checks,
  estado,
  bajaEn,
}: {
  miembro: Integrante;
  cuenta?: Cuenta;
  rol: Rol;
  checks?: Check[];
  estado?: EstadoIntegrante;
  bajaEn?: string | null;
}) {
  const admin = rol === 'ADMIN';
  const yo = useMiCuenta();
  const profesional = miembro.roles.includes('PROFESIONAL');
  const practicante = miembro.roles.includes('PRACTICANTE');
  const perfil = usePerfilProfesional(profesional || practicante ? miembro.id : undefined);
  const [escribiendo, setEscribiendo] = useState(false);
  const e = estado ? ESTADO_INTEGRANTE[estado] : null;
  const hechos = checks?.filter((c) => c.ok).length ?? 0;
  const especialidad =
    perfil.data?.especialidad ??
    (profesional ? 'Sin perfil profesional todavía' : practicante ? 'Práctica profesional supervisada' : (cuenta?.email ?? 'Cuenta del equipo'));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section
        aria-label={`Ficha de ${miembro.nombre}`}
        // Fijo arriba al desplazarse, sin cambiar de tamaño (mismo alto siempre).
        className="sticky top-0 z-20 flex flex-wrap items-center gap-[18px] rounded-lg border border-divider bg-bg p-[22px] shadow-md"
      >
        {perfil.data?.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen publica servida por la API
          <img src={perfil.data.fotoUrl} alt="" className="size-[76px] rounded-[24px] object-cover" />
        ) : (
          <Avatar name={miembro.nombre} size={76} tone={practicante ? 'patient' : 'team'} />
        )}
        <div className="flex min-w-[220px] flex-[1_1_260px] flex-col gap-1">
          <h2 className="m-0 text-[30px] leading-[1.1] font-black tracking-[-0.03em]">{miembro.nombre}</h2>
          <span className="text-[14px] font-semibold text-neutral-800">{especialidad}</span>
          <span className="flex flex-wrap gap-1.5">
            {miembro.roles.map((r, i) => (
              <Badge key={r}>
                {NOMBRE_ROL[r]}
                {miembro.roles.length > 1 && ` · ${i === 0 ? 'principal' : 'adicional'}`}
              </Badge>
            ))}
          </span>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {e ? (
            <span
              className={`inline-flex items-center gap-2 rounded-[14px] px-3.5 py-2 text-[13.5px] font-extrabold ${
                e.tono === 'positivo'
                  ? 'bg-accent-2-200 text-accent-2-900'
                  : e.tono === 'atencion'
                    ? 'bg-accent-200 text-accent-900'
                    : 'bg-neutral-200 text-neutral-800'
              }`}
            >
              <span aria-hidden className="size-2.5 rounded-full bg-current" />
              {estado === 'BAJA' && bajaEn ? `Baja programada para el ${formatoFecha(bajaEn)}` : e.texto}
            </span>
          ) : (
            <span className="text-[13px] font-semibold text-neutral-700">Revisando su estado…</span>
          )}
          <div className="flex flex-wrap gap-1.5">
            {perfil.data?.perfilPublico && profesional && (
              <ButtonLink href={`/equipo/${miembro.id}`} variant="secondary" className={CHICO}>
                Ver perfil público
              </ButtonLink>
            )}
            {miembro.id !== yo.data?.id && (
              <Button variant="secondary" className={CHICO} icon="chat" onClick={() => setEscribiendo(true)}>
                Escribirle
              </Button>
            )}
            {profesional && <AgendaProfesional profesionalId={miembro.id} nombre={miembro.nombre} />}
          </div>
        </div>
      </section>

      <Panel
        titulo="Validación"
        bajada={practicante ? 'Supervisión, práctica y acceso.' : profesional ? 'Lo necesario para atender y aparecer como verificado en el sitio.' : undefined}
        accion={checks && checks.length > 0 ? <span className="text-[13px] font-extrabold">{`${hechos} de ${checks.length} al día`}</span> : undefined}
      >
        {checks === undefined ? (
          <p className="m-0 mt-3 text-[13.5px] font-semibold text-neutral-700">Cargando la validación…</p>
        ) : checks.length === 0 ? (
          <p className="m-0 mt-3 rounded-[16px] bg-neutral-200 px-4 py-3.5 text-[13.5px] font-semibold text-neutral-800">
            Este rol no atiende pacientes, así que no requiere validación profesional.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div
              role="progressbar"
              aria-label="Validación al día"
              aria-valuemin={0}
              aria-valuemax={checks.length}
              aria-valuenow={hechos}
              className="h-2 overflow-hidden rounded-full bg-neutral-200"
            >
              <span
                className="block h-full rounded-full bg-accent-2-600 transition-[width] duration-300"
                style={{ width: `${(hechos / checks.length) * 100}%` }}
              />
            </div>
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {checks.map((c, i) => (
                <FilaCheck key={c.clave} check={c} numero={i + 1} miembro={miembro} admin={admin} />
              ))}
            </ol>
          </div>
        )}
      </Panel>

      <div className="flex flex-wrap items-start gap-4">
        {/* Izquierda: perfil, cuenta (junto a Administrativo) y calificaciones; derecha: trabajo, administrativo y tarifas. */}
        <div className="flex min-w-0 flex-[999_1_380px] flex-col gap-4">
          <PerfilPublico miembro={miembro} admin={admin} profesional={profesional} />
          {admin && cuenta && <CuentaIntegrante cuenta={cuenta} propia={cuenta.id === yo.data?.id} />}
          {profesional && <ResenasPublicas profesionalId={miembro.id} />}
        </div>
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-4 lg:max-w-[360px]">
          <TrabajoPacientes miembro={miembro} />
          <Administrativo miembro={miembro} cuenta={cuenta} admin={admin} bajaEn={bajaEn} />
          {profesional && <HistorialTarifas profesionalId={miembro.id} />}
        </div>
      </div>

      <Escribirle abierto={escribiendo} miembro={miembro} onCerrar={() => setEscribiendo(false)} />
    </div>
  );
}

/** Un paso de la validacion: estado, detalle y las acciones de ADMIN. */
function FilaCheck({ check, numero, miembro, admin }: { check: Check; numero: number; miembro: Integrante; admin: boolean }) {
  return (
    <li className={`flex flex-col gap-3 rounded-[18px] bg-bg px-4 py-3.5 ${check.ok ? 'border border-divider' : 'border-2 border-accent-500'}`}>
      <div className="flex flex-wrap items-center gap-3.5">
        <span
          aria-hidden
          className={`grid size-8 flex-none place-items-center rounded-[10px] text-[13px] font-extrabold ${
            check.ok ? 'bg-accent-2-200 text-accent-2-900' : 'bg-text text-neutral-100'
          }`}
        >
          {check.ok ? <Icon name="check" size={18} /> : numero}
        </span>
        <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
          <strong className="text-[14.5px]">{check.titulo}</strong>
          <span className="text-[13px] font-semibold text-neutral-800">{check.detalle}</span>
        </span>
        <Badge tono={check.ok ? 'positivo' : 'atencion'}>{check.ok ? 'Validado' : check.clave === 'acceso' ? 'Vencido' : 'Pendiente'}</Badge>
      </div>
      {check.clave === 'sis' && <AccionesSis profesionalId={miembro.id} ok={check.ok} admin={admin} />}
      {check.clave === 'titulo' && <Titulos profesionalId={miembro.id} admin={admin} />}
      {check.clave === 'tipos' && <TiposPorRevisar profesionalId={miembro.id} admin={admin} />}
      {check.clave === 'documentos' && (
        <div className="pl-[46px]">
          <DocumentosPracticante practicanteId={miembro.id} puedeSubir={admin} />
        </div>
      )}
      {admin && (check.clave === 'supervisor' || check.clave === 'acceso') && (
        <AccionesPracticante id={miembro.id} nombre={miembro.nombre} clave={check.clave} vigente={check.ok} />
      )}
    </li>
  );
}

function AccionesSis({ profesionalId, ok, admin }: { profesionalId: string; ok: boolean; admin: boolean }) {
  const cliente = useQueryClient();
  const clave = ['equipo', 'registro-sis', profesionalId];
  const registro = useQuery({
    queryKey: clave,
    queryFn: () => datos(api.GET('/api/profesionales/{id}/registro-sis', { params: { path: { id: profesionalId } } })),
  });
  const [manual, setManual] = useState(false);
  const [aviso, setAviso] = useState<string>();
  const verificar = useMutation({
    mutationFn: () => datos(api.POST('/api/profesionales/{id}/registro-sis/verificacion', { params: { path: { id: profesionalId } } })),
    onSuccess: (r) => {
      cliente.setQueryData(clave, r);
      setAviso(r.motivo ?? undefined);
    },
    onError: (e) => setAviso(textoError(e, 'No pudimos consultar el RNPI.')),
  });
  const r = registro.data;
  return (
    <div className="flex flex-wrap items-center gap-2 pl-[46px]">
      {admin && !ok && r?.numero && (
        <>
          <Button variant="team" className={CHICO} icon="refresh" loading={verificar.isPending} onClick={() => verificar.mutate()}>
            Verificar ahora
          </Button>
          <Button variant="secondary" className={CHICO} icon="verified_user" onClick={() => setManual(true)}>
            Verificar manualmente
          </Button>
        </>
      )}
      <a href={URL_RNPI} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-extrabold text-accent-700 underline underline-offset-2">
        Buscador público del RNPI
      </a>
      {r?.verificacionSimulada && admin && !ok && (
        <span className="w-full text-[12px] font-semibold text-neutral-700">Modo demostración: el centro aún no tiene la clave de la Superintendencia.</span>
      )}
      {aviso && (
        <p role="status" className="m-0 w-full text-[12.5px] font-bold text-accent-800">
          {aviso}
        </p>
      )}
      {admin && (
        <VerificacionManual
          abierto={manual}
          profesionalId={profesionalId}
          onListo={(x) => {
            setManual(false);
            if (x) cliente.setQueryData(clave, x);
          }}
        />
      )}
    </div>
  );
}

/** Titulos y formacion: respaldo (ver en pantalla o descargar, auditado), aprobar u observar. Sin respaldo no se aprueba (BD). */
function Titulos({ profesionalId, admin }: { profesionalId: string; admin: boolean }) {
  const trayectoria = useTrayectoria(profesionalId);
  const l = trayectoria.data ?? [];
  if (l.length === 0) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0 pl-[46px]">
      {l.map((t) => (
        <FilaTitulo key={t.id} t={t} profesionalId={profesionalId} admin={admin} />
      ))}
    </ul>
  );
}

function FilaTitulo({ t, profesionalId, admin }: { t: Trayectoria; profesionalId: string; admin: boolean }) {
  const cliente = useQueryClient();
  const [observando, setObservando] = useState(false);
  const invalidar = () => void cliente.invalidateQueries({ queryKey: ['equipo', 'trayectoria', profesionalId] });
  const verificar = useMutation({
    mutationFn: (verificado: boolean) => datos(api.POST('/api/trayectoria/{id}/verificacion', { params: { path: { id: t.id } }, body: { verificado } })),
    onSuccess: invalidar,
  });
  const observar = (
    <ObservarTitulo
      t={t}
      profesionalId={profesionalId}
      onListo={() => {
        setObservando(false);
        invalidar();
      }}
    />
  );
  return (
    <li className="flex flex-col gap-2.5 rounded-[14px] bg-neutral-100 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="min-w-0 flex-[1_1_220px]">
          <span className="block text-[13.5px] font-extrabold">{t.titulo}</span>
          <span className="block text-[12px] font-semibold text-neutral-800">
            {TIPO_TRAYECTORIA[t.tipo]} · {t.institucion} · {t.anio}
          </span>
        </span>
        <Badge tono={t.verificado ? 'positivo' : 'atencion'}>{t.verificado ? 'Verificado' : t.observacion ? 'Observado' : 'Por revisar'}</Badge>
      </div>
      <RespaldoTitulo t={t} pieVisor={admin && t.respaldos.length > 0 ? observar : undefined} />
      {admin && (
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={t.verificado ? 'ghost' : 'team'}
            className={CHICO}
            disabled={!t.verificado && t.respaldos.length === 0}
            loading={verificar.isPending}
            onClick={() => verificar.mutate(!t.verificado)}
          >
            {t.verificado ? 'Quitar verificación' : 'Aprobar'}
          </Button>
          {!observando && (
            <Button variant="secondary" icon="edit_note" className={CHICO} onClick={() => setObservando(true)}>
              Observar
            </Button>
          )}
        </div>
      )}
      {observando && observar}
      {verificar.error && (
        <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-700">
          {textoError(verificar.error, 'No pudimos guardar la verificación.')}
        </p>
      )}
    </li>
  );
}

/**
 * Observacion del documento (2026-11-08): queda en el titulo (vuelve a
 * revision hasta que suba otra version) y le llega al profesional en Mensajes.
 */
function ObservarTitulo({ t, profesionalId, onListo }: { t: Trayectoria; profesionalId: string; onListo: () => void }) {
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<string>();
  const enviar = useMutation({
    mutationFn: async () => {
      await datos(api.POST('/api/trayectoria/{id}/observacion', { params: { path: { id: t.id } }, body: { observacion: texto.trim() } }));
      await escribir(
        profesionalId,
        `Observación sobre tu título «${t.titulo}»`,
        `La cuenta madre observó el respaldo de «${t.titulo}»: ${texto.trim()}

Sube una versión nueva desde «Mi perfil» > Formación para que lo revisen otra vez.`,
      );
    },
    onSuccess: () => {
      setTexto('');
      setAviso('Observación enviada. Le llegó a su bandeja de Mensajes.');
      onListo();
    },
  });
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border-2 border-accent-500 bg-bg p-3">
      <Field label="Observación sobre el documento" hint="El título vuelve a revisión hasta que suba una versión nueva.">
        {(x) => (
          <Textarea
            {...x}
            rows={2}
            maxLength={500}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Ej.: el respaldo está cortado, no se ve la fecha de titulación."
          />
        )}
      </Field>
      {enviar.error && (
        <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-700">
          {textoError(enviar.error, 'No pudimos guardar la observación.')}
        </p>
      )}
      {aviso && (
        <p role="status" className="m-0 text-[12.5px] font-bold text-accent-2-800">
          {aviso}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button variant="team" className={CHICO} disabled={texto.trim().length < 3} loading={enviar.isPending} onClick={() => enviar.mutate()}>
          Enviar observación
        </Button>
      </div>
    </div>
  );
}

function TiposPorRevisar({ profesionalId, admin }: { profesionalId: string; admin: boolean }) {
  const cliente = useQueryClient();
  const tipos = useTiposDeProfesional(profesionalId);
  const especialidades = useEspecialidadesDe(profesionalId);
  const catalogo = useTiposAtencion();
  const catEsp = useEspecialidades();
  const nombreTipo = new Map((catalogo.data ?? []).map((t) => [t.id, t.nombre]));
  const nombreEsp = new Map((catEsp.data ?? []).map((x) => [x.id, x.nombre]));
  const [asignar, setAsignar] = useState(false);
  const revisar = useMutation({
    mutationFn: async ({ tipo, id, aprobar }: { tipo: 'tipo' | 'esp'; id: string; aprobar: boolean }) => {
      await (tipo === 'tipo'
        ? datos(
            api.PATCH('/api/profesionales/{id}/tipos-atencion/{tipoAtencionId}', {
              params: { path: { id: profesionalId, tipoAtencionId: id } },
              body: { estado: aprobar ? 'APROBADO' : 'RECHAZADO' },
            }),
          )
        : datos(
            api.POST('/api/profesionales/{id}/especialidades/{especialidadId}/revision', {
              params: { path: { id: profesionalId, especialidadId: id } },
              body: { aprobar },
            }),
          ));
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['equipo', 'tipos', profesionalId] });
      void cliente.invalidateQueries({ queryKey: ['equipo', 'especialidades', profesionalId] });
      void cliente.invalidateQueries({ queryKey: ['equipo', 'propuestas'] });
    },
  });
  const aprobados = [
    ...(tipos.data ?? []).filter((t) => t.estado === 'APROBADO').map((t) => nombreTipo.get(t.tipoAtencionId)),
    ...(especialidades.data ?? []).filter((x) => x.estado === 'APROBADO').map((x) => nombreEsp.get(x.especialidadId)),
  ].filter((x): x is string => !!x);
  const pendientes = [
    ...(tipos.data ?? [])
      .filter((t) => t.estado === 'PROPUESTO')
      .map((t) => ({ tipo: 'tipo' as const, id: t.tipoAtencionId, nombre: nombreTipo.get(t.tipoAtencionId) })),
    ...(especialidades.data ?? [])
      .filter((x) => x.estado === 'PROPUESTO')
      .map((x) => ({ tipo: 'esp' as const, id: x.especialidadId, nombre: nombreEsp.get(x.especialidadId) })),
  ];
  return (
    <div className="flex flex-col gap-2 pl-[46px]">
      {aprobados.length > 0 && <p className="m-0 text-[12.5px] font-semibold text-neutral-800">Aprobados: {aprobados.join(' · ')}</p>}
      {pendientes.map((p) => (
        <div key={`${p.tipo}-${p.id}`} className="flex flex-wrap items-center gap-2 rounded-[14px] bg-neutral-100 px-3 py-2">
          <span className="min-w-0 flex-1 text-[13.5px] font-bold">
            {p.nombre ?? (p.tipo === 'tipo' ? 'Tipo de atención' : 'Especialidad')}
            <span className="ml-1.5 text-[12px] font-semibold text-neutral-700">{p.tipo === 'tipo' ? 'tipo de atención' : 'especialidad'}</span>
          </span>
          {admin && (
            <>
              <Button variant="team" className={CHICO} onClick={() => revisar.mutate({ ...p, aprobar: true })}>
                Aprobar
              </Button>
              <Button variant="ghost" className={CHICO} onClick={() => revisar.mutate({ ...p, aprobar: false })}>
                Rechazar
              </Button>
            </>
          )}
        </div>
      ))}
      {revisar.error && (
        <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-700">
          {textoError(revisar.error, 'No pudimos guardar la revisión.')}
        </p>
      )}
      {admin && (
        <Button variant="ghost" icon="checklist" onClick={() => setAsignar(true)} className={`${CHICO} self-start`}>
          Asignar tipos
        </Button>
      )}
      <Modal abierto={asignar} onCerrar={() => setAsignar(false)} titulo="Asignar tipos de atención">
        {asignar && (
          <AsignarTipos
            profesionalId={profesionalId}
            actuales={(tipos.data ?? []).filter((t) => t.estado === 'APROBADO').map((t) => t.tipoAtencionId)}
            catalogo={(catalogo.data ?? []).filter((t) => t.activo)}
            onListo={() => setAsignar(false)}
          />
        )}
      </Modal>
    </div>
  );
}

function AccionesPracticante({ id, nombre, clave, vigente }: { id: string; nombre: string; clave: 'supervisor' | 'acceso'; vigente: boolean }) {
  const [accion, setAccion] = useState<'extender' | 'supervisor' | 'revocar' | 'historial' | null>(null);
  return (
    <div className="flex flex-wrap gap-2 pl-[46px]">
      {clave === 'supervisor' ? (
        <Button variant="secondary" className={CHICO} onClick={() => setAccion('supervisor')}>
          Cambiar supervisor
        </Button>
      ) : (
        <>
          <Button variant={vigente ? 'secondary' : 'team'} className={CHICO} onClick={() => setAccion('extender')}>
            {vigente ? 'Extender' : 'Dar acceso'}
          </Button>
          {vigente && (
            <Button variant="ghost" className={CHICO} onClick={() => setAccion('revocar')}>
              Revocar
            </Button>
          )}
          <Button variant="ghost" className={CHICO} onClick={() => setAccion('historial')}>
            Historial
          </Button>
        </>
      )}
      {accion && <AccionPracticante key={accion} tipo={accion} id={id} nombre={nombre} onCerrar={() => setAccion(null)} />}
    </div>
  );
}

/** Perfil publico en solo lectura + avisos + pedir una correccion (ADMIN). */
function PerfilPublico({ miembro, admin, profesional }: { miembro: Integrante; admin: boolean; profesional: boolean }) {
  const perfil = usePerfilProfesional(profesional ? miembro.id : undefined);
  const tarifas = useTarifas(profesional ? miembro.id : undefined);
  const p = perfil.data;
  const general = tarifasVigentes(tarifas.data ?? [], Date.now()).sort((a, b) => Number(!!a.tipoAtencionId) - Number(!!b.tipoAtencionId))[0];
  const alertas = p ? alertasPerfil(p) : [];
  return (
    <Panel
      titulo="Perfil público"
      accion={<Badge>Solo lectura</Badge>}
      bajada={profesional ? 'Lo edita el profesional en Mi perfil.' : undefined}
      className="h-full"
    >
      <div className="mt-3 flex flex-col gap-3">
        {!profesional ? (
          <p className="m-0 rounded-[16px] bg-neutral-200 px-4 py-3.5 text-[13.5px] font-semibold text-neutral-800">No tiene perfil público.</p>
        ) : perfil.isPending ? (
          <p className="m-0 text-[13.5px] font-semibold text-neutral-700">Cargando…</p>
        ) : !p ? (
          <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Todavía no completa su perfil. Lo crea desde «Mi perfil».</p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 rounded-[18px] bg-neutral-100 px-4 py-4">
              <span className="flex flex-wrap items-center gap-2">
                <strong className="text-[18px] font-black tracking-[-0.02em]">{p.nombrePublico || miembro.nombre}</strong>
                <Badge tono={p.perfilPublico ? 'positivo' : 'neutro'}>{p.perfilPublico ? 'Publicado' : 'Sin publicar'}</Badge>
              </span>
              <span className="text-[13px] font-semibold text-neutral-800">
                {p.especialidad} · {NOMBRE_MODALIDAD[p.modalidad]}
                {general && ` · Tarifa ${formatoClp(general.monto)}`}
              </span>
              {p.citaDestacada && <span className="text-[14px] text-neutral-800 italic">“{p.citaDestacada}”</span>}
              <span className="line-clamp-4 text-[13px] whitespace-pre-line text-neutral-900">{p.bio || 'Sin texto «Sobre mí».'}</span>
            </div>
            {alertas.length > 0 && (
              <ul aria-label="Avisos del perfil" className="m-0 flex list-none flex-col gap-1.5 p-0">
                {alertas.map((a) => (
                  <li key={a} className="flex items-center gap-2 rounded-[14px] bg-accent-100 px-3 py-2.5 text-[13px] font-semibold text-accent-900">
                    <span aria-hidden className="size-2 flex-none rounded-full bg-accent-600" />
                    {a}
                  </li>
                ))}
              </ul>
            )}
            {admin && <PedirCorreccion miembro={miembro} perfil={p} />}
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * Pedir una correccion por campo (2026-11-08). No modifica el perfil: queda
 * registrada y le llega al profesional en Mensajes. Si un campo ya se pidio y
 * el profesional no lo cambio, a la segunda solicitud la cuenta madre puede
 * corregirlo ella misma (regla del centro; la BD lo exige) y se le avisa.
 */
function PedirCorreccion({ miembro, perfil }: { miembro: Integrante; perfil: PerfilProfesional }) {
  const cliente = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [campos, setCampos] = useState<CampoPerfil[]>([]);
  const [motivo, setMotivo] = useState('');
  const [segundas, setSegundas] = useState<CampoPerfil[]>([]);
  const [aviso, setAviso] = useState<string>();
  const historial = useQuery({
    queryKey: ['equipo', 'correcciones', miembro.id],
    queryFn: () => datos(api.GET('/api/profesionales/{id}/correcciones', { params: { path: { id: miembro.id } } })),
  });
  const enviar = useMutation({
    mutationFn: async () => {
      const r = await datos(
        api.POST('/api/profesionales/{id}/correcciones', { params: { path: { id: miembro.id } }, body: { campos, motivo: motivo.trim() } }),
      );
      await escribir(
        miembro.id,
        'Corrección de tu perfil público',
        `Te pedimos corregir en «Mi perfil»: ${campos.map((c) => CAMPO[c].toLocaleLowerCase('es')).join(', ')}.\n\nMotivo: ${motivo.trim()}`,
      );
      return r;
    },
    onSuccess: (r) => {
      const segunda = r.filter((x) => x.solicitudes >= 2 && x.campo !== 'foto_url').map((x) => x.campo as CampoPerfil);
      setSegundas(segunda);
      setAviso(
        segunda.length
          ? `Es la segunda solicitud sin cambios de: ${segunda.map((c) => CAMPO[c].toLocaleLowerCase('es')).join(', ')}. Ahora puedes corregirlo tú.`
          : 'Corrección pedida. Le llegó a su bandeja de Mensajes.',
      );
      setAbierto(false);
      setCampos([]);
      setMotivo('');
      void cliente.invalidateQueries({ queryKey: ['equipo', 'correcciones', miembro.id] });
      void cliente.invalidateQueries({ queryKey: ['hilos'] });
    },
  });
  const pedidas = (historial.data ?? []).slice(0, 4);
  return (
    <div className="flex flex-col gap-2">
      {aviso && (
        <p role="status" className="m-0 rounded-[14px] bg-accent-2-200 px-3 py-2.5 text-[13px] font-bold text-accent-2-900">
          {aviso}
        </p>
      )}
      {segundas.map((c) => (
        <CorregirCampo key={c} miembro={miembro} campo={c} actual={valorCampo(perfil, c)} onListo={() => setSegundas((l) => l.filter((x) => x !== c))} />
      ))}
      {!abierto ? (
        <Button variant="secondary" onClick={() => setAbierto(true)} className="self-start">
          Pedir una corrección
        </Button>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-[18px] border-2 border-accent-500 bg-bg p-4">
          <span id={`campos-${miembro.id}`} className="text-[12.5px] font-extrabold">
            ¿Qué debe corregir?
          </span>
          <div role="group" aria-labelledby={`campos-${miembro.id}`} className="flex flex-wrap gap-1.5">
            {(Object.keys(CAMPO) as CampoPerfil[]).map((c) => {
              const on = campos.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCampos((l) => (on ? l.filter((x) => x !== c) : [...l, c]))}
                  className={`min-h-[34px] cursor-pointer rounded-full border px-3 text-[12px] font-extrabold ${
                    on ? 'border-text bg-text text-neutral-100' : 'border-neutral-400 bg-bg hover:border-accent-500'
                  }`}
                >
                  {CAMPO[c]}
                </button>
              );
            })}
          </div>
          <Field label="Motivo" required hint="Le llega al profesional. No nombres pacientes: es una conversación general.">
            {(x) => (
              <Textarea
                {...x}
                rows={2}
                maxLength={500}
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
                placeholder="Ej.: quita el número de WhatsApp del texto Sobre mí."
              />
            )}
          </Field>
          {enviar.error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {textoError(enviar.error, 'No pudimos enviar la corrección.')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="team" disabled={campos.length === 0 || motivo.trim().length < 3} loading={enviar.isPending} onClick={() => enviar.mutate()}>
              Enviar al profesional
            </Button>
            <Button variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
          </div>
          <span className="text-[12px] font-semibold text-neutral-700">
            No se modifica su perfil. Si a la segunda solicitud del mismo dato no lo cambió, podrás corregirlo tú.
          </span>
        </div>
      )}
      {pedidas.length > 0 && (
        <ul aria-label="Correcciones recientes" className="m-0 flex list-none flex-col gap-1 p-0">
          {pedidas.map((c) => (
            <li key={c.id} className="text-[12px] font-semibold text-neutral-700">
              {formatoFecha(c.creadaEn)} · {c.accion === 'APLICADA' ? 'Corregido por la cuenta madre' : 'Pedido'}: {CAMPO[c.campo as CampoPerfil] ?? c.campo} —{' '}
              {c.motivo}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** La cuenta madre corrige el campo y le avisa al profesional (que puede volver a cambiarlo). */
function CorregirCampo({ miembro, campo, actual, onListo }: { miembro: Integrante; campo: CampoPerfil; actual: string; onListo: () => void }) {
  const cliente = useQueryClient();
  const [valor, setValor] = useState(actual);
  const [razon, setRazon] = useState('');
  const largo = campo === 'bio' || campo === 'cita_destacada';
  const corregir = useMutation({
    mutationFn: async () => {
      await datos(
        api.POST('/api/profesionales/{id}/correcciones/aplicacion', {
          params: { path: { id: miembro.id } },
          body: { campo: campo as Exclude<CampoPerfil, 'foto_url'>, valor, motivo: razon.trim() },
        }),
      );
      await escribir(
        miembro.id,
        `Administración cambió «${CAMPO[campo]}» de tu perfil`,
        `Administración cambió el campo «${CAMPO[campo]}» por esta razón: ${razon.trim()}\n\nSi crees que no es correcto, modifícalo en «Mi perfil» e indica el cambio a administración.`,
      );
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['equipo', 'perfil', miembro.id] });
      void cliente.invalidateQueries({ queryKey: ['equipo', 'correcciones', miembro.id] });
      onListo();
    },
  });
  if (campo === 'foto_url') return null;
  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] border-2 border-pendiente-700 bg-pendiente-100 p-4">
      <strong className="text-[13.5px] text-pendiente-900">Corregir «{CAMPO[campo]}» (segunda solicitud sin cambios)</strong>
      <Field label={`${CAMPO[campo]} corregido`} hint={campo === 'enfoques' ? 'Separados por coma.' : undefined}>
        {(x) =>
          largo ? (
            <Textarea {...x} rows={3} maxLength={2000} value={valor} onChange={(e) => setValor(e.target.value)} />
          ) : (
            <Input {...x} maxLength={300} value={valor} onChange={(e) => setValor(e.target.value)} />
          )
        }
      </Field>
      <Field label="Razón del cambio" required hint="Se le envía al profesional junto con el aviso.">
        {(x) => <Input {...x} maxLength={500} value={razon} onChange={(e) => setRazon(e.target.value)} />}
      </Field>
      {corregir.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {textoError(corregir.error, 'No pudimos corregir el campo.')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="team" disabled={razon.trim().length < 3} loading={corregir.isPending} onClick={() => corregir.mutate()}>
          Corregir y avisarle
        </Button>
        <Button variant="ghost" onClick={onListo}>
          Ahora no
        </Button>
      </div>
    </div>
  );
}

function Fila({ etiqueta, valor, accion, tono }: { etiqueta: string; valor: string; accion?: ReactNode; tono?: 'alerta' | 'ok' }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-neutral-100 px-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[12px] font-semibold text-neutral-700">{etiqueta}</span>
        <strong className={`text-[13.5px] first-letter:uppercase ${tono === 'alerta' ? 'text-accent-800' : tono === 'ok' ? 'text-accent-2-800' : ''}`}>
          {valor}
        </strong>
      </span>
      {accion}
    </div>
  );
}

function TrabajoPacientes({ miembro }: { miembro: Integrante }) {
  const profesional = miembro.roles.includes('PROFESIONAL');
  const practicante = miembro.roles.includes('PRACTICANTE');
  const estados = useEstadoFichas(profesional ? miembro.id : undefined);
  const proxima = (estados.data ?? [])
    .map((x) => x.proxima_sesion)
    .filter((x): x is string => !!x)
    .sort()[0];
  const sinCerrar = estados.data?.reduce((s, x) => s + x.sesiones_sin_cerrar, 0) ?? 0;
  return (
    <Panel titulo="Trabajo con pacientes" bajada={profesional ? 'Solo estado administrativo.' : undefined}>
      <div className="mt-3 flex flex-col gap-2">
        {profesional ? (
          <>
            <Fila etiqueta="Pacientes a su cargo" valor={estados.isSuccess ? String(estados.data.length) : '…'} />
            <Fila etiqueta="Sesiones sin cerrar" valor={estados.isSuccess ? String(sinCerrar) : '…'} tono={sinCerrar ? 'alerta' : 'ok'} />
            <Fila etiqueta="Próxima sesión" valor={proxima ? `${formatoFechaLarga(proxima)}, ${formatoHora(proxima)}` : 'Sin horas agendadas'} />
            <Link href={`/admin/fichas?equipo=${miembro.id}`} className="text-[13px] font-extrabold text-accent-700 underline underline-offset-2">
              Ver su seguimiento en Fichas y Pacientes
            </Link>
          </>
        ) : practicante ? (
          <>
            <p className="m-0 text-[13px] font-semibold text-neutral-800">Atiende bajo supervisión y con el consentimiento de cada paciente.</p>
            <Link href="/admin/fichas?vista=supervision" className="text-[13px] font-extrabold text-accent-700 underline underline-offset-2">
              Ver la supervisión en Fichas y Pacientes
            </Link>
          </>
        ) : (
          <Fila etiqueta="Acceso" valor="Rol administrativo: no atiende pacientes" />
        )}
      </div>
    </Panel>
  );
}

function Administrativo({ miembro, cuenta, admin, bajaEn }: { miembro: Integrante; cuenta?: Cuenta; admin: boolean; bajaEn?: string | null }) {
  const profesional = miembro.roles.includes('PROFESIONAL');
  const conDatos = profesional || miembro.roles.includes('PRACTICANTE');
  const tarifas = useTarifas(profesional ? miembro.id : undefined);
  const acuerdos = useQuery({
    queryKey: ['cobros', 'acuerdos'],
    queryFn: () => datos(api.GET('/api/cobros/acuerdos')),
    enabled: admin && profesional,
    retry: false,
  });
  const [verDatos, setVerDatos] = useState(false);
  const privados = useDatosPrivados(conDatos ? miembro.id : undefined, verDatos);
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
  const acuerdo = (acuerdos.data ?? [])
    .filter((a) => a.profesionalId === miembro.id && a.vigenteDesde.slice(0, 10) <= hoy)
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0];
  const vigentes = tarifasVigentes(tarifas.data ?? [], Date.now());
  const general = vigentes.find((t) => !t.tipoAtencionId && !t.modalidad) ?? vigentes[0];
  const d = privados.data;
  return (
    <Panel titulo="Administrativo">
      <div className="mt-3 flex flex-col gap-2">
        {cuenta?.email && <Fila etiqueta="Correo de la cuenta" valor={cuenta.email} />}
        {profesional && (
          <Fila
            etiqueta="Tarifa vigente (la fija el profesional)"
            valor={general ? `${formatoClp(general.monto)} desde ${formatoFecha(general.vigenteDesde)}` : 'Sin tarifa: no puede publicar su perfil'}
            tono={general ? undefined : 'alerta'}
          />
        )}
        {admin && profesional && acuerdos.isSuccess && (
          <Fila
            etiqueta="Acuerdo con el centro"
            valor={acuerdo ? ACUERDO[acuerdo.modelo] : 'Reglas generales del centro'}
            accion={
              <ButtonLink href="/admin/configuracion?seccion=cobros" variant="ghost" className={CHICO}>
                Ver
              </ButtonLink>
            }
          />
        )}
        {conDatos && (
          <Fila
            etiqueta="Datos para pagos"
            valor={
              verDatos
                ? privados.isPending
                  ? '…'
                  : d
                    ? `${d.banco ?? 'Banco'} · ${d.tipoCuenta ?? ''} ${d.numeroCuenta ?? ''}`.trim()
                    : 'No los registra todavía'
                : 'Cifrados'
            }
            accion={
              <Button variant="ghost" className={CHICO} icon={verDatos ? 'visibility_off' : 'visibility'} onClick={() => setVerDatos((v) => !v)}>
                {verDatos ? 'Ocultar' : 'Ver datos'}
              </Button>
            }
          />
        )}
        {verDatos && d && (
          <p className="m-0 px-1 text-[12.5px] font-semibold text-neutral-800">
            RUT {d.rut ?? '—'} · Titular {d.titular ?? '—'}
          </p>
        )}
        <Fila
          etiqueta="Cuenta"
          valor={
            cuenta?.cerradaEn
              ? `Cerrada el ${formatoFecha(cuenta.cerradaEn)}`
              : bajaEn
                ? `Baja programada para el ${formatoFecha(bajaEn)}`
                : miembro.activo
                  ? 'Activa'
                  : 'Desactivada'
          }
          tono={bajaEn || !miembro.activo ? 'alerta' : undefined}
        />
        {conDatos && <span className="px-1 text-[12px] font-semibold text-neutral-700">Ver los datos para pagos queda en la auditoría.</span>}
      </div>
    </Panel>
  );
}

function Escribirle({ abierto, miembro, onCerrar }: { abierto: boolean; miembro: Integrante; onCerrar: () => void }) {
  const router = useRouter();
  const [asunto, setAsunto] = useState('');
  const [texto, setTexto] = useState('');
  const enviar = useMutation({
    mutationFn: () => escribir(miembro.id, asunto.trim(), texto.trim()),
    onSuccess: (hilo) => router.push(`/admin/mensajes?hilo=${hilo}`),
  });
  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={`Escribirle a ${miembro.nombre}`}
      descripcion="Se abre una conversación general en Mensajes. No nombres pacientes: para un caso, usa la conversación del caso."
      acciones={
        <>
          <Button variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button variant="team" icon="send" disabled={!asunto.trim() || !texto.trim()} loading={enviar.isPending} onClick={() => enviar.mutate()}>
            Enviar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Asunto" required>
          {(x) => <Input {...x} maxLength={200} value={asunto} onChange={(e) => setAsunto(e.target.value)} />}
        </Field>
        <Field label="Mensaje" required>
          {(x) => <Textarea {...x} rows={4} maxLength={4000} value={texto} onChange={(e) => setTexto(e.target.value)} />}
        </Field>
        {enviar.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {textoError(enviar.error, 'No pudimos enviar el mensaje.')}
          </p>
        )}
      </div>
    </Modal>
  );
}
