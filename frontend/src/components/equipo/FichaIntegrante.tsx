'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Estrellas } from '@/components/ui/Estrellas';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import {
  ESTADO_REVISION,
  NOMBRE_ROL,
  TIPO_TRAYECTORIA,
  useDatosPrivados,
  useEspecialidades,
  useEspecialidadesDe,
  usePerfilProfesional,
  useTarifas,
  useTiposDeProfesional,
  useTrayectoria,
  useCuentasEquipo,
  useSupervisiones,
  type Cuenta,
} from '@/lib/equipo';
import { useConfiguracionCentro } from '@/lib/centro';
import { useMiCuenta, useModulos, useProfesionales } from '@/lib/consultas';
import { formatoClp, formatoFecha, formatoFechaLarga, formatoHora } from '@/lib/formato';
import { inicioDiaChile, sumarDias, useEstadoFichas, useTiposAtencion } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { FormularioPerfil } from './FormularioPerfil';
import { RegistroSisPanel } from './RegistroSis';
import { RespaldoTitulo } from './RespaldoTitulo';

const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

/**
 * Ficha de un integrante (diseño "Perfil Profesional"): perfil publico,
 * tipos de atencion y especialidades (ADMIN aprueba), trayectoria (ADMIN
 * verifica), tarifas, datos privados a pedido, agenda y pacientes (solo
 * estado administrativo), reseñas publicadas y la cuenta (ADMIN).
 * propio: "Mi perfil" de la cuenta madre (2026-10-27): sin aprobar ni
 * verificar lo propio y sin la cabecera (la pone Mi perfil).
 */
export function FichaIntegrante({
  miembro,
  cuenta,
  rol,
  propio = false,
}: {
  miembro: { id: string; nombre: string; roles: Rol[] };
  cuenta?: Cuenta;
  rol: Rol;
  propio?: boolean;
}) {
  const admin = rol === 'ADMIN' && !propio;
  const yo = useMiCuenta();
  const profesional = miembro.roles.includes('PROFESIONAL') || miembro.roles.includes('PRACTICANTE');
  const perfil = usePerfilProfesional(profesional ? miembro.id : undefined);
  const estados = useEstadoFichas(miembro.roles.includes('PROFESIONAL') ? miembro.id : undefined);
  const proxima = (estados.data ?? [])
    .map((e) => e.proxima_sesion)
    .filter((x): x is string => !!x)
    .sort()[0];

  return (
    <div className="flex flex-col gap-5">
      <div className={`flex flex-wrap items-center gap-4 rounded-lg border border-divider bg-bg px-6 py-5 shadow-sm ${propio ? 'hidden' : ''}`}>
        {perfil.data?.fotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagen publica servida por la API
          <img src={perfil.data.fotoUrl} alt="" className="size-16 rounded-full object-cover" />
        ) : (
          <Avatar name={miembro.nombre} size={64} />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[24px] leading-tight font-black tracking-[-0.03em]">{miembro.nombre}</h2>
          <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
            {profesional ? (perfil.data?.especialidad ?? 'Sin perfil profesional todavía') : (cuenta?.email ?? 'Cuenta del equipo')}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {miembro.roles.map((r) => (
              <Badge key={r}>{NOMBRE_ROL[r]}</Badge>
            ))}
            {perfil.data?.perfilPublico && <Badge tono="positivo">Perfil publicado</Badge>}
            {cuenta && !cuenta.activo && <Badge tono="neutro">Cuenta desactivada</Badge>}
            {cuenta?.fechaExpiracionAcceso && <Badge tono="atencion">Acceso hasta {formatoFecha(cuenta.fechaExpiracionAcceso)}</Badge>}
          </div>
        </div>
      </div>

      {profesional && (
        <Panel
          titulo={propio ? 'Mi perfil profesional' : 'Descripción y datos del perfil'}
          bajada="Se muestran en el perfil público del centro. Publicarlo lo decide cada profesional."
        >
          <div className="mt-4">
            <EstadoConsulta consulta={perfil}>
              {(p) =>
                p ? (
                  <FormularioPerfil key={p.updatedAt} modo="equipo" profesionalId={miembro.id} perfil={p} puedeFoto={admin} />
                ) : (
                  <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Todavía no completa su perfil. Lo crea cada profesional desde «Mi perfil».</p>
                )
              }
            </EstadoConsulta>
          </div>
        </Panel>
      )}

      {miembro.roles.includes('PROFESIONAL') && (
        <Panel titulo="Horas y pacientes" bajada="Solo estado administrativo: el contenido clínico vive en la ficha de cada paciente.">
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Dato etiqueta="Pacientes a su cargo" valor={estados.isSuccess ? String(estados.data.length) : '…'} />
            <Dato etiqueta="Sesiones sin cerrar" valor={estados.isSuccess ? String(estados.data.reduce((s, e) => s + e.sesiones_sin_cerrar, 0)) : '…'} />
            <Dato etiqueta="Próxima sesión" valor={proxima ? `${formatoFechaLarga(proxima)}, ${formatoHora(proxima)}` : 'Sin horas agendadas'} />
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[13px] font-extrabold">
            {/* La agenda y los pacientes de este integrante (selector de equipo por la URL). */}
            <Link href={`/admin/agenda?equipo=${miembro.id}`} className="text-accent-700 underline underline-offset-2">
              {propio ? 'Ver mi agenda' : 'Ver su agenda'}
            </Link>
            <Link href={`/admin/fichas?equipo=${miembro.id}`} className="text-accent-700 underline underline-offset-2">
              {propio ? 'Ver mis pacientes' : 'Ver sus pacientes'}
            </Link>
          </div>
        </Panel>
      )}

      {profesional && <Revisiones profesionalId={miembro.id} admin={admin} />}
      {profesional && !propio && (
        <RegistroSisPanel
          profesionalId={miembro.id}
          practicante={!miembro.roles.includes('PROFESIONAL')}
          propio={miembro.id === yo.data?.id && rol === 'PROFESIONAL'}
          admin={admin}
        />
      )}
      {profesional && <TrayectoriaTarifas profesionalId={miembro.id} admin={admin} />}
      {profesional && <DatosPrivados profesionalId={miembro.id} />}
      {miembro.roles.includes('PROFESIONAL') && <ResenasPublicas profesionalId={miembro.id} />}
      {admin && cuenta && <CuentaIntegrante cuenta={cuenta} propia={cuenta.id === yo.data?.id} />}
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-[14px] border border-divider bg-bg px-3.5 py-3">
      <div className="mb-1 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">{etiqueta}</div>
      <div className="text-[15px] font-black tracking-[-0.01em] first-letter:uppercase">{valor}</div>
    </div>
  );
}

/** Tipos de atencion y especialidades declaradas: solo los aprobados cuentan en el match y el perfil. */
function Revisiones({ profesionalId, admin }: { profesionalId: string; admin: boolean }) {
  const cliente = useQueryClient();
  const tipos = useTiposDeProfesional(profesionalId);
  const catalogo = useTiposAtencion();
  const especialidades = useEspecialidadesDe(profesionalId);
  const catEsp = useEspecialidades();
  const nombreTipo = new Map((catalogo.data ?? []).map((t) => [t.id, t.nombre]));
  const nombreEsp = new Map((catEsp.data ?? []).map((e) => [e.id, e.nombre]));
  const [error, setError] = useState<string>();
  const [asignar, setAsignar] = useState(false);
  const revisarTipo = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: 'APROBADO' | 'RECHAZADO' }) =>
      datos(
        api.PATCH('/api/profesionales/{id}/tipos-atencion/{tipoAtencionId}', { params: { path: { id: profesionalId, tipoAtencionId: id } }, body: { estado } }),
      ),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['equipo', 'tipos', profesionalId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos revisar el tipo de atención.'),
  });
  const revisarEsp = useMutation({
    mutationFn: ({ id, aprobar }: { id: string; aprobar: boolean }) =>
      datos(
        api.POST('/api/profesionales/{id}/especialidades/{especialidadId}/revision', {
          params: { path: { id: profesionalId, especialidadId: id } },
          body: { aprobar },
        }),
      ),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['equipo', 'especialidades', profesionalId] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos revisar la especialidad.'),
  });
  const fila = (clave: string, nombre: string, estado: keyof typeof ESTADO_REVISION, aprobar: () => void, rechazar: () => void) => {
    const e = ESTADO_REVISION[estado];
    return (
      <li key={clave} className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-divider bg-bg px-3.5 py-2">
        <span className="min-w-0 flex-1 text-[14px] font-bold">{nombre}</span>
        <Badge tono={e.tono}>{e.texto}</Badge>
        {admin && estado === 'PROPUESTO' && (
          <>
            <Button variant="ghost" icon="check" onClick={aprobar} className="!px-3 !py-1.5 !text-[12.5px]">
              Aprobar
            </Button>
            <Button variant="ghost" icon="close" onClick={rechazar} className="!px-3 !py-1.5 !text-[12.5px]">
              Rechazar
            </Button>
          </>
        )}
      </li>
    );
  };
  return (
    <Panel
      titulo="Tipos de atención y especialidades"
      bajada="El profesional los declara; solo los aprobados aparecen en el match, el directorio y las plantillas clínicas."
      accion={
        admin && (
          <Button variant="secondary" icon="checklist" onClick={() => setAsignar(true)} className="!py-2.5">
            Asignar tipos
          </Button>
        )
      }
    >
      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <div>
          <p className="m-0 mb-2 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Tipos de atención</p>
          <EstadoConsulta consulta={tipos} vacio={(l) => l.length === 0} textoVacio="Sin tipos declarados">
            {(l) => (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {l.map((t) =>
                  fila(
                    t.tipoAtencionId,
                    nombreTipo.get(t.tipoAtencionId) ?? 'Tipo de atención',
                    t.estado,
                    () => revisarTipo.mutate({ id: t.tipoAtencionId, estado: 'APROBADO' }),
                    () => revisarTipo.mutate({ id: t.tipoAtencionId, estado: 'RECHAZADO' }),
                  ),
                )}
              </ul>
            )}
          </EstadoConsulta>
        </div>
        <div>
          <p className="m-0 mb-2 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Especialidades</p>
          <EstadoConsulta consulta={especialidades} vacio={(l) => l.length === 0} textoVacio="Sin especialidades declaradas">
            {(l) => (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {l.map((x) =>
                  fila(
                    x.especialidadId,
                    nombreEsp.get(x.especialidadId) ?? 'Especialidad',
                    x.estado,
                    () => revisarEsp.mutate({ id: x.especialidadId, aprobar: true }),
                    () => revisarEsp.mutate({ id: x.especialidadId, aprobar: false }),
                  ),
                )}
              </ul>
            )}
          </EstadoConsulta>
        </div>
      </div>
      {error && (
        <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-700">
          {error}
        </p>
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
    </Panel>
  );
}

/** ADMIN asigna los tipos directamente (quedan aprobados); reemplaza la lista completa. */
export function AsignarTipos({
  profesionalId,
  actuales,
  catalogo,
  onListo,
}: {
  profesionalId: string;
  actuales: string[];
  catalogo: { id: string; nombre: string }[];
  onListo: () => void;
}) {
  const cliente = useQueryClient();
  const [elegidos, setElegidos] = useState(actuales);
  const guardar = useMutation({
    mutationFn: () =>
      datos(api.PUT('/api/profesionales/{id}/tipos-atencion', { params: { path: { id: profesionalId } }, body: { tipoAtencionIds: elegidos } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['equipo', 'tipos', profesionalId] });
      onListo();
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
        Quedan aprobados y cuentan en el match y el directorio. Los que quites dejan de ofrecerse; las horas ya agendadas no cambian.
      </p>
      <ChoiceGroup
        legend="Tipos de atención"
        type="checkbox"
        value={elegidos}
        onChange={setElegidos}
        options={catalogo.map((t) => ({ value: t.id, label: t.nombre }))}
      />
      {guardar.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {guardar.error instanceof ApiError ? guardar.error.message : 'No pudimos asignar los tipos.'}
        </p>
      )}
      <div className="flex justify-end gap-2.5">
        <Button variant="ghost" onClick={onListo}>
          Cancelar
        </Button>
        <Button variant="team" icon="save" loading={guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar
        </Button>
      </div>
    </div>
  );
}

function TrayectoriaTarifas({ profesionalId, admin }: { profesionalId: string; admin: boolean }) {
  const cliente = useQueryClient();
  const trayectoria = useTrayectoria(profesionalId);
  const verificar = useMutation({
    mutationFn: ({ id, verificado }: { id: string; verificado: boolean }) =>
      datos(api.POST('/api/trayectoria/{id}/verificacion', { params: { path: { id } }, body: { verificado } })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['equipo', 'trayectoria', profesionalId] }),
  });
  return (
    <div className="flex flex-col gap-5">
      <Panel
        titulo="Trayectoria"
        bajada={admin ? 'Descarga el respaldo y verifica cada título. Sin respaldo no se puede verificar.' : 'Títulos y formación declarados.'}
      >
        <div className="mt-4">
          {verificar.error && (
            <p role="alert" className="m-0 mb-3 text-[13px] font-bold text-accent-700">
              {verificar.error instanceof ApiError ? verificar.error.message : 'No pudimos guardar la verificación.'}
            </p>
          )}
          <EstadoConsulta consulta={trayectoria} vacio={(l) => l.length === 0} textoVacio="Sin trayectoria declarada">
            {(l) => (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {l.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-divider bg-bg px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[14px] font-extrabold">{t.titulo}</p>
                      <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
                        {TIPO_TRAYECTORIA[t.tipo]} · {t.institucion} · {t.anio}
                        {t.registroSuperintendencia && ` · Registro ${t.registroSuperintendencia}`}
                      </p>
                      <div className="mt-2 max-w-md">
                        <RespaldoTitulo t={t} />
                      </div>
                    </div>
                    <Badge tono={t.verificado ? 'positivo' : 'neutro'}>{t.verificado ? 'Verificado' : 'Sin verificar'}</Badge>
                    {admin && (
                      <Button
                        variant="ghost"
                        disabled={!t.verificado && t.respaldos.length === 0}
                        onClick={() => verificar.mutate({ id: t.id, verificado: !t.verificado })}
                        className="!px-3 !py-1.5 !text-[12.5px]"
                      >
                        {t.verificado ? 'Quitar verificación' : 'Verificar'}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </EstadoConsulta>
        </div>
      </Panel>
      <HistorialTarifas profesionalId={profesionalId} />
    </div>
  );
}

/** Historial de tarifas: la vigente es la mas reciente (2026-11-08: tambien en la ficha de Equipo). */
export function HistorialTarifas({ profesionalId }: { profesionalId: string }) {
  const tarifas = useTarifas(profesionalId);
  const catalogo = useTiposAtencion();
  const nombreTipo = new Map((catalogo.data ?? []).map((t) => [t.id, t.nombre]));
  return (
    <Panel titulo="Tarifas" bajada="Historial: la vigente es la más reciente. El monto de cada cita se fija al confirmarla.">
      <div className="mt-4">
        <EstadoConsulta consulta={tarifas} vacio={(l) => l.length === 0} textoVacio="Sin tarifas registradas">
          {(l) => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {l.slice(0, 8).map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-[14px] border border-divider bg-bg px-3.5 py-2 text-[13.5px] font-bold"
                >
                  <span className="min-w-0 flex-1">
                    {t.tipoAtencionId ? (nombreTipo.get(t.tipoAtencionId) ?? 'Tipo de atención') : 'General'}
                    {t.modalidad && ` · ${t.modalidad === 'ONLINE' ? 'Online' : 'Presencial'}`}
                  </span>
                  <span className="tabular-nums">{formatoClp(t.monto)}</span>
                  <span className="w-full text-[12px] font-semibold text-neutral-700">desde {formatoFecha(t.vigenteDesde)}</span>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </div>
    </Panel>
  );
}

/**
 * RUT y cuenta bancaria (cifrados): se descifran solo al pedirlos y no se guardan en cache.
 * MVP sin COBROS (2026-11-11): solo el RUT; la cuenta bancaria no se muestra.
 */
function DatosPrivados({ profesionalId }: { profesionalId: string }) {
  const [ver, setVer] = useState(false);
  const privados = useDatosPrivados(profesionalId, ver);
  const cobros = useModulos().data?.activos.includes('COBROS') ?? false;
  return (
    <Panel
      titulo={cobros ? 'Datos para pagos' : 'RUT'}
      bajada={cobros ? 'RUT y cuenta bancaria del profesional, para liquidaciones. Se guardan cifrados.' : 'RUT del profesional. Se guarda cifrado.'}
      accion={
        <Button variant="secondary" icon={ver ? 'visibility_off' : 'visibility'} onClick={() => setVer((v) => !v)} className="!py-2.5">
          {ver ? 'Ocultar' : 'Ver datos'}
        </Button>
      }
    >
      {ver && (
        <div className="mt-4">
          <EstadoConsulta consulta={privados}>
            {(d) =>
              d ? (
                <dl className="m-0 grid gap-3 sm:grid-cols-2">
                  {[
                    ['RUT', d.rut],
                    ['Titular', d.titular],
                    ['Banco', d.banco],
                    ['Tipo de cuenta', d.tipoCuenta],
                    ['Número de cuenta', d.numeroCuenta],
                  ]
                    .filter(([k]) => cobros || k === 'RUT')
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">{k}</dt>
                        <dd className="m-0 text-[14px] font-bold">{v ?? '—'}</dd>
                      </div>
                    ))}
                </dl>
              ) : (
                <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
                  {cobros ? 'Todavía no registra sus datos para pagos.' : 'Todavía no registra su RUT.'}
                </p>
              )
            }
          </EstadoConsulta>
        </div>
      )}
    </Panel>
  );
}

export function ResenasPublicas({ profesionalId }: { profesionalId: string }) {
  const resenas = useQuery({
    queryKey: ['equipo', 'resenas-publicas', profesionalId],
    queryFn: () => datos(api.GET('/api/publico/profesionales/{id}/resenas', { params: { path: { id: profesionalId } } })),
  });
  return (
    <Panel
      titulo="Calificaciones"
      bajada="Solo lectura: son anónimas y no se editan ni eliminan. Se modera en la pestaña Reseñas."
      accion={<Badge>Solo lectura</Badge>}
    >
      <div className="mt-4">
        <EstadoConsulta consulta={resenas} vacio={(l) => l.length === 0} textoVacio="Todavía no hay calificaciones publicadas">
          {(l) => {
            const promedio = l.reduce((s, r) => s + r.calificacion, 0) / l.length;
            return (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-[34px] font-black tracking-[-0.03em] tabular-nums">{promedio.toFixed(1).replace('.', ',')}</span>
                  <Estrellas valor={Math.round(promedio)} />
                  <span className="text-[13px] font-bold text-neutral-800">
                    {l.length} {l.length === 1 ? 'calificación' : 'calificaciones'}
                  </span>
                </div>
                {l.slice(0, 3).map((r) => (
                  <blockquote key={r.id} className="m-0 rounded-[14px] border border-divider bg-bg px-4 py-3">
                    <Estrellas valor={r.calificacion} />
                    {r.texto && <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed text-neutral-800">{r.texto}</p>}
                    <footer className="mt-1.5 text-[12px] font-semibold text-neutral-700">
                      {r.autor} · {formatoFecha(r.fecha)}
                    </footer>
                  </blockquote>
                ))}
              </div>
            );
          }}
        </EstadoConsulta>
      </div>
    </Panel>
  );
}

/** Cuenta (solo ADMIN): activar, invitacion, segundo factor, rol PROFESIONAL adicional y baja. */
const PASTILLAS_ROL = [
  { rol: 'ADMIN', etiqueta: 'Cuenta madre', icono: 'shield_person' },
  { rol: 'GESTION', etiqueta: 'Gestión', icono: 'admin_panel_settings' },
  { rol: 'PROFESIONAL', etiqueta: 'Profesional', icono: 'person' },
  { rol: 'PRACTICANTE', etiqueta: 'Practicante', icono: 'school' },
] as const;

/** Roles que una cuenta del equipo combina (BD: roles_adicionales_equipo). PRACTICANTE es exclusivo. */
const ROLES_COMBINABLES: readonly Rol[] = ['ADMIN', 'GESTION', 'PROFESIONAL'];

/**
 * "Rol dentro del centro" (diseño "Perfil Profesional", 03b-4.1 pendiente 2).
 * Correcciones 2026-11-11 (punto 4): la cuenta madre agrega o quita roles
 * adicionales con las mismas pastillas (roles fijos, asignacion flexible). El
 * principal no se cambia (regla de la BD) y el practicante no combina roles.
 * Cuenta madre y gestion se quitan al instante; el profesional, con fecha de
 * baja (su agenda y citas). Gestion solo si el centro la tiene habilitada.
 */
function RolesCentro({
  cuenta,
  editable,
  gestionHabilitada,
  cupo,
  ocupado,
  onAgregar,
  onQuitar,
}: {
  cuenta: Cuenta;
  editable: boolean;
  gestionHabilitada: boolean;
  /** Cuentas madre activas y maximo del centro (null = sin limite). */
  cupo: { usadas: number; max: number | null };
  ocupado: boolean;
  onAgregar: (rol: Rol) => void;
  onQuitar: (rol: Rol) => void;
}) {
  const adicionales = cuenta.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol);
  const combinable = ROLES_COMBINABLES.includes(cuenta.rol);
  const visibles = PASTILLAS_ROL.filter((p) => p.rol !== 'GESTION' || gestionHabilitada || cuenta.rol === 'GESTION' || adicionales.includes('GESTION'));
  return (
    <div className="flex flex-col gap-2">
      <span id={`roles-${cuenta.id}`} className="text-[12px] font-extrabold text-neutral-800">
        Rol dentro del centro
      </span>
      <ul aria-labelledby={`roles-${cuenta.id}`} className="m-0 flex list-none flex-wrap gap-2 p-0">
        {visibles.map((p) => {
          const principal = cuenta.rol === p.rol;
          const tiene = principal || adicionales.includes(p.rol);
          const baja = cuenta.rolesAdicionales.find((r) => r.rol === p.rol && r.activo)?.fechaBaja;
          // Con el cupo lleno no se suma otra cuenta madre (regla del centro; la BD tambien lo exige).
          const sinCupo = p.rol === 'ADMIN' && !tiene && cupo.max !== null && cupo.usadas >= cupo.max;
          const cambia = editable && combinable && !principal && ROLES_COMBINABLES.includes(p.rol) && !baja && !sinCupo;
          const clases = `flex items-center gap-[7px] rounded-full border-[1.5px] px-4 py-[9px] text-[12.5px] font-extrabold ${
            tiene ? 'border-accent-2-600 bg-accent-2-200 text-accent-2-900' : 'border-neutral-400 bg-neutral-100 text-neutral-800'
          }`;
          const contenido = (
            <>
              <Icon name={cambia ? (tiene ? 'check' : 'add') : p.icono} size={16} />
              {p.etiqueta}
              {principal && <span className="font-bold">· principal</span>}
              {!principal && tiene && <span className="font-bold">{baja ? `· baja el ${formatoFecha(baja)}` : '· adicional'}</span>}
              {!tiene && <span className="sr-only">(no tiene este rol)</span>}
            </>
          );
          return (
            <li key={p.rol}>
              {cambia ? (
                <button
                  type="button"
                  aria-pressed={tiene}
                  disabled={ocupado}
                  title={tiene ? `Quitar el rol ${p.etiqueta.toLowerCase()}` : `Agregar el rol ${p.etiqueta.toLowerCase()}`}
                  onClick={() => (tiene ? onQuitar(p.rol) : onAgregar(p.rol))}
                  className={`${clases} cursor-pointer transition-colors duration-200 hover:border-accent-2-700 disabled:cursor-wait disabled:opacity-60`}
                >
                  {contenido}
                </button>
              ) : (
                <span aria-current={tiene ? 'true' : undefined} className={clases}>
                  {contenido}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {editable && combinable && (
        <p className="m-0 text-[12px] font-semibold text-neutral-700">
          Toca un rol para agregarlo o quitarlo. Cada rol es una sesión distinta: la persona elige con cuál entrar.
          {cupo.max !== null && ` Cuentas madre: ${cupo.usadas} de ${cupo.max}${cupo.usadas >= cupo.max ? ' (cupo lleno: se cambia en Configuración)' : ''}.`}
        </p>
      )}
    </div>
  );
}

export function CuentaIntegrante({ cuenta, propia }: { cuenta: Cuenta; propia: boolean }) {
  const cliente = useQueryClient();
  const [aviso, setAviso] = useState<{ error?: string; ok?: string }>({});
  const [baja, setBaja] = useState<'rol' | 'cuenta' | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const listo = (ok: string) => () => {
    setAviso({ ok });
    setBaja(null);
    void cliente.invalidateQueries({ queryKey: ['equipo', 'cuentas'] });
    void cliente.invalidateQueries({ queryKey: ['directorio'] });
  };
  const fallo = (e: unknown) => setAviso({ error: e instanceof ApiError ? e.message : 'No pudimos completar la acción.' });
  const activar = useMutation({
    mutationFn: (activo: boolean) => datos(api.PATCH('/api/usuarios/{id}', { params: { path: { id: cuenta.id } }, body: { activo } })),
    onSuccess: (_d, activo) => listo(activo ? 'Cuenta activada.' : 'Cuenta desactivada.')(),
    onError: fallo,
  });
  const invitar = useMutation({
    mutationFn: () => datos(api.POST('/api/usuarios/{id}/invitacion', { params: { path: { id: cuenta.id } } })),
    onSuccess: (r) => listo(`Invitación enviada. Vence el ${formatoFechaLarga(r.invitacionVence)}.`)(),
    onError: fallo,
  });
  const totp = useMutation({
    mutationFn: () => datos(api.POST('/api/usuarios/{id}/totp/reinicio', { params: { path: { id: cuenta.id } } })),
    onSuccess: listo('Segundo factor reiniciado: lo configura de nuevo al ingresar.'),
    onError: fallo,
  });
  const nombreRol = (r: Rol) => PASTILLAS_ROL.find((p) => p.rol === r)?.etiqueta.toLowerCase() ?? r;
  const otorgar = useMutation({
    mutationFn: (rol: 'ADMIN' | 'GESTION' | 'PROFESIONAL') =>
      datos(api.POST('/api/usuarios/{id}/roles', { params: { path: { id: cuenta.id } }, body: { rol } })),
    onSuccess: (_d, rol) => listo(`Rol ${nombreRol(rol)} agregado. Lo usa desde su próximo ingreso.`)(),
    onError: fallo,
  });
  const quitar = useMutation({
    mutationFn: (rol: 'ADMIN' | 'GESTION') => datos(api.POST('/api/usuarios/{id}/roles/retiro', { params: { path: { id: cuenta.id } }, body: { rol } })),
    onSuccess: (_d, rol) => listo(`Rol ${nombreRol(rol)} quitado: sus sesiones con ese rol se cerraron.`)(),
    onError: fallo,
  });
  const configuracion = useConfiguracionCentro().data;
  const gestionHabilitada = configuracion?.rolGestionHabilitado ?? false;
  const cuentas = useCuentasEquipo(true);
  const cupo = {
    usadas: (cuentas.data ?? []).filter((c) => c.activo && !c.cerradaEn && (c.rol === 'ADMIN' || c.rolesAdicionales.some((r) => r.rol === 'ADMIN' && r.activo)))
      .length,
    max: configuracion?.maxCuentasMadre ?? null,
  };
  // La BD no da de baja a quien supervisa practicantes activos: se elige el nuevo supervisor en el mismo paso.
  const supervisiones = useSupervisiones();
  const profesionales = useProfesionales(true);
  const activa = new Set((cuentas.data ?? []).filter((c) => c.activo).map((c) => c.id));
  const supervisados = (supervisiones.data ?? [])
    .filter((s) => s.supervisorId === cuenta.id && !s.hasta && activa.has(s.practicanteId))
    .map((s) => s.practicanteId);
  const [supervisorNuevo, setSupervisorNuevo] = useState('');
  const sinSupervisor = supervisados.length > 0 && !supervisorNuevo;
  // Baja ahora (desde este instante) o al final del dia elegido (medianoche de Chile siguiente: ese dia se atiende completo).
  const darBaja = useMutation({
    mutationFn: async ({ ahora }: { ahora: boolean }) => {
      const fechaEfectiva = (ahora ? new Date() : inicioDiaChile(sumarDias(fecha, 1))).toISOString();
      for (const practicante of supervisados) {
        await datos(api.POST('/api/practicantes/{id}/supervisor', { params: { path: { id: practicante } }, body: { supervisorId: supervisorNuevo } }));
      }
      return baja === 'rol'
        ? datos(api.POST('/api/usuarios/{id}/roles/PROFESIONAL/baja', { params: { path: { id: cuenta.id } }, body: { fechaEfectiva } }))
        : datos(api.POST('/api/bajas', { body: { usuarioId: cuenta.id, fechaEfectiva } }));
    },
    onSuccess: (r, { ahora }) => {
      void cliente.invalidateQueries({ queryKey: ['equipo', 'supervisiones'] });
      listo(
        ahora
          ? `Baja aplicada: su agenda quedó bloqueada desde ahora y su acceso se cierra en los próximos minutos. Citas por reprogramar: ${r.citasPorReprogramar}.`
          : `Baja programada para el final del ${formatoFechaLarga(inicioDiaChile(fecha).toISOString())}. Citas por reprogramar: ${r.citasPorReprogramar}.`,
      )();
    },
    onError: fallo,
  });
  const cerrada = !!cuenta.cerradaEn;
  return (
    <Panel titulo="Cuenta" bajada={`${cuenta.email ?? 'Sin correo'}${cuenta.totpActivo ? ' · segundo factor activo' : ''}`}>
      <div className="mt-4 flex flex-col gap-4">
        <RolesCentro
          cuenta={cuenta}
          editable={!propia && !cerrada}
          gestionHabilitada={gestionHabilitada}
          cupo={cupo}
          ocupado={otorgar.isPending || quitar.isPending}
          onAgregar={(rol) => {
            setAviso({});
            if (rol === 'ADMIN' || rol === 'GESTION' || rol === 'PROFESIONAL') otorgar.mutate(rol);
          }}
          onQuitar={(rol) => {
            setAviso({});
            // El profesional tiene agenda: su baja lleva fecha y reprograma citas.
            if (rol === 'PROFESIONAL') setBaja('rol');
            else if (rol === 'ADMIN' || rol === 'GESTION') quitar.mutate(rol);
          }}
        />
        {propia ? (
          <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
            Es tu propia cuenta: tus datos y tu contraseña se cambian en «Mi perfil». Otra cuenta madre administra tu acceso.
          </p>
        ) : cerrada ? (
          <p className="m-0 text-[13.5px] font-semibold text-neutral-800">
            Cuenta cerrada el {formatoFecha(cuenta.cerradaEn!)}: si vuelve, se crea una cuenta nueva.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cuenta.rol !== 'PRACTICANTE' && (
              <Button variant="secondary" loading={activar.isPending} onClick={() => activar.mutate(!cuenta.activo)} className="!py-2.5">
                {cuenta.activo ? 'Desactivar cuenta' : 'Activar cuenta'}
              </Button>
            )}
            <Button variant="secondary" icon="mail" loading={invitar.isPending} onClick={() => invitar.mutate()} className="!py-2.5">
              Reenviar invitación
            </Button>
            {cuenta.totpActivo && (
              <Button variant="secondary" loading={totp.isPending} onClick={() => totp.mutate()} className="!py-2.5">
                Reiniciar segundo factor
              </Button>
            )}
            {cuenta.rol === 'PROFESIONAL' && (
              <Button variant="ghost" onClick={() => setBaja('cuenta')} className="!py-2.5">
                Dar de baja al profesional
              </Button>
            )}
          </div>
        )}
        {baja && (
          <div className="flex flex-col gap-3 rounded-[18px] border border-accent-500 bg-accent-100 p-4">
            <p className="m-0 text-[13.5px] font-semibold text-accent-900">
              Desde la baja su agenda queda bloqueada y sus citas pendientes pasan a «por reprogramar»; sus pacientes quedan en la cola de reasignación. Su
              historial clínico no se borra.
            </p>
            {supervisados.length > 0 && (
              <Field
                label={`Nuevo supervisor de sus ${supervisados.length === 1 ? 'practicante' : `${supervisados.length} practicantes`}`}
                hint="Supervisa practicantes activos: pasan al profesional que elijas antes de la baja. Sus pacientes reciben el aviso del cambio."
                required
              >
                {(x) => (
                  <Select {...x} value={supervisorNuevo} onChange={(e) => setSupervisorNuevo(e.target.value)}>
                    <option value="">Elige un profesional</option>
                    {(profesionales.data ?? [])
                      .filter((p) => p.id !== cuenta.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre ?? 'Profesional'}
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col justify-between gap-3 rounded-lg border border-divider bg-bg p-3.5">
                <div>
                  <h4 className="m-0 text-[14px] font-black">Ahora</h4>
                  <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
                    Desde este momento. Las citas de hoy que aún no empiezan también pasan a reprogramar.
                  </p>
                </div>
                <Button
                  variant="team"
                  icon="event_busy"
                  disabled={sinSupervisor || darBaja.isPending}
                  loading={darBaja.isPending && darBaja.variables?.ahora}
                  onClick={() => darBaja.mutate({ ahora: true })}
                >
                  Dar de baja ahora
                </Button>
              </div>
              <div className="flex flex-col justify-between gap-3 rounded-lg border border-divider bg-bg p-3.5">
                <div className="flex flex-col gap-2">
                  <h4 className="m-0 text-[14px] font-black">Al final de un día</h4>
                  <Field label="Último día de atención" hint="Atiende ese día completo; la baja corre a la medianoche.">
                    {(x) => <Input {...x} type="date" min={hoy()} value={fecha} onChange={(e) => setFecha(e.target.value)} className="!w-[200px]" />}
                  </Field>
                </div>
                <Button
                  variant="secondary"
                  icon="event"
                  disabled={!fecha || sinSupervisor || darBaja.isPending}
                  loading={darBaja.isPending && !darBaja.variables?.ahora}
                  onClick={() => darBaja.mutate({ ahora: false })}
                >
                  Programar para el {fecha ? formatoFecha(inicioDiaChile(fecha).toISOString()) : '…'}
                </Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setBaja(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        {aviso.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {aviso.error}
          </p>
        )}
        {aviso.ok && !aviso.error && (
          <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
            {aviso.ok}
          </p>
        )}
      </div>
    </Panel>
  );
}
