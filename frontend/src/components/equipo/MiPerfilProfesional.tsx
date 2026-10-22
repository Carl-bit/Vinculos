'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Estrellas } from '@/components/ui/Estrellas';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import {
  ESTADO_REVISION,
  TIPO_TRAYECTORIA,
  useDatosPrivados,
  useEspecialidades,
  useEspecialidadesDe,
  usePerfilProfesional,
  useTarifas,
  useTiposDeProfesional,
  useTrayectoria,
  type Trayectoria,
} from '@/lib/equipo';
import { formatoClp, formatoFecha, rutValido } from '@/lib/formato';
import { useTiposAtencion } from '@/lib/panel';

import { FormularioPerfil } from './FormularioPerfil';
import { CampoRut, rutNormalizado } from '@/components/shared/CampoRut';

type DatosPrivadosDto = components['schemas']['DatosPrivadosDto'];
const BANCOS: NonNullable<DatosPrivadosDto['banco']>[] = [
  'Banco de Chile',
  'BancoEstado',
  'Santander',
  'BCI',
  'Scotiabank',
  'Itau',
  'BICE',
  'Security',
  'Falabella',
  'Ripley',
  'Consorcio',
  'Internacional',
  'Coopeuch',
  'Tenpo',
  'Mercado Pago',
  'MACH',
];
const CUENTAS: Record<NonNullable<DatosPrivadosDto['tipoCuenta']>, string> = {
  CORRIENTE: 'Cuenta corriente',
  VISTA: 'Cuenta vista',
  AHORRO: 'Cuenta de ahorro',
  CUENTA_RUT: 'CuentaRUT',
};
const ESTADO_RESENA = { PENDIENTE: 'Por moderar', PUBLICADA: 'Publicada', OCULTA: 'Oculta', RETIRADA: 'Retirada' } as const;

/**
 * "Mis datos y descripcion" (diseño "Admin - Mi Perfil"): lo que sale en el
 * perfil publico. Años de experiencia y registro profesional salen de la
 * trayectoria verificada (solo lectura: se editan en Trayectoria).
 */
export function MisDatosDescripcion({ usuarioId }: { usuarioId: string }) {
  const perfil = usePerfilProfesional(usuarioId);
  const trayectoria = useTrayectoria(usuarioId).data ?? [];
  const verificada = trayectoria.filter((t) => t.verificado);
  const primerAnio = Math.min(...verificada.filter((t) => t.tipo === 'TITULO').map((t) => t.anio));
  const registro = verificada.find((t) => t.registroSuperintendencia)?.registroSuperintendencia;
  const soloLectura = (etiqueta: string, valor: string) => (
    <div className="flex flex-col gap-[7px]">
      <span className="text-[12.5px] font-extrabold">{etiqueta}</span>
      <span className="rounded-full border-[1.5px] border-dashed border-neutral-400 px-[18px] py-3 text-[15px] font-semibold text-neutral-800">{valor}</span>
    </div>
  );
  return (
    <Panel
      titulo="Mis datos y descripción"
      bajada={
        <span className="inline-flex items-center gap-1.5">
          <Icon name="public" size={16} />
          Estos datos se muestran en mi perfil público del centro.
        </span>
      }
    >
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {soloLectura('Años de experiencia', Number.isFinite(primerAnio) ? `${new Date().getFullYear() - primerAnio} años` : 'Según tu título verificado')}
        {soloLectura('Registro profesional', registro ? `Superintendencia de Salud · ${registro}` : 'Sin registro verificado')}
      </div>
      <div className="mt-4">
        <EstadoConsulta consulta={perfil}>
          {(p) => <FormularioPerfil key={p?.updatedAt ?? 'nuevo'} modo="propio" profesionalId={usuarioId} perfil={p} puedeFoto={false} />}
        </EstadoConsulta>
      </div>
    </Panel>
  );
}

/**
 * Lo demas que el profesional gestiona de si mismo: tipos de atencion y
 * especialidades que declara (ADMIN aprueba), trayectoria, tarifas y datos
 * para pagos. El practicante solo trayectoria y datos para pagos.
 */
export function MasDeMiPerfil({ usuarioId, practicante }: { usuarioId: string; practicante: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      {!practicante && <MisDeclaraciones usuarioId={usuarioId} />}
      <MiTrayectoria usuarioId={usuarioId} />
      {!practicante && <MisTarifas usuarioId={usuarioId} />}
      <MisDatosPrivados usuarioId={usuarioId} />
    </div>
  );
}

function MisDeclaraciones({ usuarioId }: { usuarioId: string }) {
  const cliente = useQueryClient();
  const tipos = useTiposDeProfesional(usuarioId);
  const catalogo = useTiposAtencion();
  const especialidades = useEspecialidadesDe(usuarioId);
  const catEsp = useEspecialidades();
  const [tipo, setTipo] = useState('');
  const [esp, setEsp] = useState('');
  const [error, setError] = useState<string>();
  const proponer = useMutation({
    mutationFn: () => datos(api.POST('/api/profesionales/yo/tipos-atencion', { body: { tipoAtencionId: tipo } })),
    onSuccess: () => {
      setTipo('');
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['equipo', 'tipos', usuarioId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos enviar la propuesta.'),
  });
  const declarar = useMutation({
    mutationFn: () => datos(api.POST('/api/profesionales/yo/especialidades', { body: { especialidadId: esp } })),
    onSuccess: () => {
      setEsp('');
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['equipo', 'especialidades', usuarioId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos declarar la especialidad.'),
  });
  const nombreTipo = new Map((catalogo.data ?? []).map((t) => [t.id, t.nombre]));
  const nombreEsp = new Map((catEsp.data ?? []).map((e) => [e.id, e.nombre]));
  const tiposLibres = (catalogo.data ?? []).filter((t) => t.activo && !(tipos.data ?? []).some((x) => x.tipoAtencionId === t.id));
  const espLibres = (catEsp.data ?? []).filter((e) => e.activo && !(especialidades.data ?? []).some((x) => x.especialidadId === e.id));
  const chips = (l: { id: string; nombre: string; estado: keyof typeof ESTADO_REVISION }[]) => (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {l.map((x) => (
        <li key={x.id} className="inline-flex items-center gap-2 rounded-full border border-divider bg-bg py-1 pr-1.5 pl-3.5 text-[13px] font-bold">
          {x.nombre}
          <Badge tono={ESTADO_REVISION[x.estado].tono}>{ESTADO_REVISION[x.estado].texto}</Badge>
        </li>
      ))}
    </ul>
  );
  return (
    <Panel
      titulo="Tipos de atención y especialidades"
      bajada="Los declaras tú y los aprueba la cuenta madre. Solo los aprobados aparecen en el match y en tu perfil."
    >
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Tipos de atención</p>
          {chips((tipos.data ?? []).map((t) => ({ id: t.tipoAtencionId, nombre: nombreTipo.get(t.tipoAtencionId) ?? 'Tipo', estado: t.estado })))}
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Proponer tipo de atención" value={tipo} onChange={(e) => setTipo(e.target.value)} className="!max-w-[260px] !py-2">
              <option value="">Proponer un tipo…</option>
              {tiposLibres.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </Select>
            <Button variant="secondary" disabled={!tipo} loading={proponer.isPending} onClick={() => proponer.mutate()} className="!py-2.5">
              Proponer
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Especialidades</p>
          {chips(
            (especialidades.data ?? []).map((x) => ({ id: x.especialidadId, nombre: nombreEsp.get(x.especialidadId) ?? 'Especialidad', estado: x.estado })),
          )}
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Declarar especialidad" value={esp} onChange={(e) => setEsp(e.target.value)} className="!max-w-[260px] !py-2">
              <option value="">Declarar una especialidad…</option>
              {espLibres.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </Select>
            <Button variant="secondary" disabled={!esp} loading={declarar.isPending} onClick={() => declarar.mutate()} className="!py-2.5">
              Declarar
            </Button>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="m-0 mt-3 text-[13px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </Panel>
  );
}

const TRAYECTORIA_VACIA = { tipo: 'TITULO' as Trayectoria['tipo'], titulo: '', institucion: '', anio: '', registroSuperintendencia: '' };

function MiTrayectoria({ usuarioId }: { usuarioId: string }) {
  const cliente = useQueryClient();
  const lista = useTrayectoria(usuarioId);
  const [f, setF] = useState(TRAYECTORIA_VACIA);
  const [editando, setEditando] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const refrescar = () => {
    setF(TRAYECTORIA_VACIA);
    setEditando(null);
    setError(undefined);
    void cliente.invalidateQueries({ queryKey: ['equipo', 'trayectoria', usuarioId] });
  };
  const guardar = useMutation({
    mutationFn: () => {
      const body = {
        tipo: f.tipo,
        titulo: f.titulo.trim(),
        institucion: f.institucion.trim(),
        anio: Number(f.anio),
        registroSuperintendencia: f.registroSuperintendencia.trim() || undefined,
      };
      return editando ? datos(api.PUT('/api/trayectoria/{id}', { params: { path: { id: editando } }, body })) : datos(api.POST('/api/trayectoria', { body }));
    },
    onSuccess: refrescar,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar la trayectoria.'),
  });
  const eliminar = useMutation({
    mutationFn: (id: string) => datos(api.DELETE('/api/trayectoria/{id}', { params: { path: { id } } })),
    onSuccess: refrescar,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos eliminar el registro.'),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const anio = Number(f.anio);
    if (!f.titulo.trim() || !f.institucion.trim() || !Number.isInteger(anio) || anio < 1950 || anio > new Date().getFullYear())
      return setError('Completa título, institución y un año válido.');
    guardar.mutate();
  };
  return (
    <Panel titulo="Trayectoria" bajada="Títulos y formación. La cuenta madre los verifica; editar uno lo vuelve a dejar sin verificar.">
      <div className="mt-4 flex flex-col gap-3">
        <EstadoConsulta consulta={lista} vacio={(l) => l.length === 0} textoVacio="Todavía no agregas tu formación">
          {(l) => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {l.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2.5 rounded-[14px] border border-divider bg-bg px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[14px] font-extrabold">{t.titulo}</p>
                    <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
                      {TIPO_TRAYECTORIA[t.tipo]} · {t.institucion} · {t.anio}
                    </p>
                  </div>
                  <Badge tono={t.verificado ? 'positivo' : 'neutro'}>{t.verificado ? 'Verificado' : 'Sin verificar'}</Badge>
                  <button
                    type="button"
                    aria-label={`Editar ${t.titulo}`}
                    onClick={() => {
                      setEditando(t.id);
                      setF({
                        tipo: t.tipo,
                        titulo: t.titulo,
                        institucion: t.institucion,
                        anio: String(t.anio),
                        registroSuperintendencia: t.registroSuperintendencia ?? '',
                      });
                    }}
                    className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
                  >
                    <Icon name="edit" size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Eliminar ${t.titulo}`}
                    onClick={() => eliminar.mutate(t.id)}
                    className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
                  >
                    <Icon name="delete" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
        <form onSubmit={enviar} noValidate className="grid gap-3 rounded-[18px] border-[1.5px] border-dashed border-neutral-400 p-4 sm:grid-cols-2">
          <Field label="Tipo">
            {(x) => (
              <Select {...x} value={f.tipo} onChange={(e) => setF((y) => ({ ...y, tipo: e.target.value as Trayectoria['tipo'] }))}>
                {(Object.keys(TIPO_TRAYECTORIA) as Trayectoria['tipo'][]).map((k) => (
                  <option key={k} value={k}>
                    {TIPO_TRAYECTORIA[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Título" required>
            {(x) => <Input {...x} value={f.titulo} maxLength={200} onChange={(e) => setF((y) => ({ ...y, titulo: e.target.value }))} />}
          </Field>
          <Field label="Institución" required>
            {(x) => <Input {...x} value={f.institucion} maxLength={200} onChange={(e) => setF((y) => ({ ...y, institucion: e.target.value }))} />}
          </Field>
          <Field label="Año" required>
            {(x) => (
              <Input
                {...x}
                inputMode="numeric"
                value={f.anio}
                maxLength={4}
                onChange={(e) => setF((y) => ({ ...y, anio: e.target.value.replace(/\D/g, '') }))}
              />
            )}
          </Field>
          <Field label="Registro Superintendencia de Salud (opcional)">
            {(x) => (
              <Input
                {...x}
                value={f.registroSuperintendencia}
                maxLength={40}
                onChange={(e) => setF((y) => ({ ...y, registroSuperintendencia: e.target.value }))}
              />
            )}
          </Field>
          <div className="flex items-end justify-end gap-2">
            {editando && (
              <Button variant="ghost" onClick={refrescar}>
                Cancelar
              </Button>
            )}
            <Button type="submit" variant="secondary" icon={editando ? 'save' : 'add'} loading={guardar.isPending}>
              {editando ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </div>
        </form>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}

function MisTarifas({ usuarioId }: { usuarioId: string }) {
  const cliente = useQueryClient();
  const tarifas = useTarifas(usuarioId);
  const catalogo = useTiposAtencion();
  const nombreTipo = new Map((catalogo.data ?? []).map((t) => [t.id, t.nombre]));
  const [f, setF] = useState({ monto: '', tipoAtencionId: '', modalidad: '' });
  const [error, setError] = useState<string>();
  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/profesionales/yo/tarifas', {
          body: {
            monto: Number(f.monto),
            tipoAtencionId: f.tipoAtencionId || undefined,
            modalidad: (f.modalidad || undefined) as 'PRESENCIAL' | 'ONLINE' | undefined,
          },
        }),
      ),
    onSuccess: () => {
      setF({ monto: '', tipoAtencionId: '', modalidad: '' });
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['equipo', 'tarifas', usuarioId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos registrar la tarifa.'),
  });
  return (
    <Panel
      titulo="Tarifas"
      bajada="Una tarifa nueva reemplaza a la anterior desde hoy; las citas ya confirmadas mantienen su monto. Sin tipo ni modalidad es tu tarifa general."
    >
      <div className="mt-4 flex flex-col gap-3">
        <EstadoConsulta consulta={tarifas} vacio={(l) => l.length === 0} textoVacio="Sin tarifas: necesitas una general para publicar tu perfil">
          {(l) => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {l.slice(0, 6).map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-[14px] border border-divider bg-bg px-3.5 py-2 text-[13.5px] font-bold">
                  <span className="min-w-0 flex-1">
                    {t.tipoAtencionId ? (nombreTipo.get(t.tipoAtencionId) ?? 'Tipo') : 'General'}
                    {t.modalidad && ` · ${t.modalidad === 'ONLINE' ? 'Online' : 'Presencial'}`}
                  </span>
                  <span className="tabular-nums">{formatoClp(t.monto)}</span>
                  <span className="text-[12px] font-semibold text-neutral-700">desde {formatoFecha(t.vigenteDesde)}</span>
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
        <div className="flex flex-wrap items-end gap-2.5 rounded-[18px] border-[1.5px] border-dashed border-neutral-400 p-4">
          <Field label="Monto (CLP)" required>
            {(x) => (
              <Input
                {...x}
                inputMode="numeric"
                value={f.monto}
                onChange={(e) => setF((y) => ({ ...y, monto: e.target.value.replace(/\D/g, '') }))}
                className="!w-[150px] !py-2"
              />
            )}
          </Field>
          <Field label="Tipo de atención">
            {(x) => (
              <Select {...x} value={f.tipoAtencionId} onChange={(e) => setF((y) => ({ ...y, tipoAtencionId: e.target.value }))} className="!py-2">
                <option value="">Todos (general)</option>
                {catalogo.data
                  ?.filter((t) => t.activo)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field label="Modalidad">
            {(x) => (
              <Select {...x} value={f.modalidad} onChange={(e) => setF((y) => ({ ...y, modalidad: e.target.value }))} className="!py-2">
                <option value="">Ambas</option>
                <option value="PRESENCIAL">Presencial</option>
                <option value="ONLINE">Online</option>
              </Select>
            )}
          </Field>
          <Button variant="secondary" icon="add" disabled={!Number(f.monto)} loading={crear.isPending} onClick={() => crear.mutate()} className="!py-2.5">
            Registrar tarifa
          </Button>
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}

function MisDatosPrivados({ usuarioId }: { usuarioId: string }) {
  const [abierto, setAbierto] = useState(false);
  const privados = useDatosPrivados(usuarioId, abierto);
  return (
    <Panel
      titulo="Datos para pagos"
      bajada="Tu RUT y cuenta bancaria, para liquidaciones y boletas. Se guardan cifrados y solo los ve administración."
      accion={
        <Button variant="secondary" icon={abierto ? 'visibility_off' : 'edit'} onClick={() => setAbierto((v) => !v)} className="!py-2.5">
          {abierto ? 'Cerrar' : 'Ver o editar'}
        </Button>
      }
    >
      {abierto && (
        <div className="mt-4">
          <EstadoConsulta consulta={privados}>{(d) => <FormularioPrivados key={d?.updatedAt ?? 'nuevo'} inicial={d} />}</EstadoConsulta>
        </div>
      )}
    </Panel>
  );
}

function FormularioPrivados({ inicial }: { inicial: components['schemas']['DatosPrivadosVista'] | null }) {
  const cliente = useQueryClient();
  const [f, setF] = useState({
    rut: inicial?.rut ?? '',
    banco: inicial?.banco ?? '',
    tipoCuenta: inicial?.tipoCuenta ?? '',
    numeroCuenta: inicial?.numeroCuenta ?? '',
    titular: inicial?.titular ?? '',
  });
  const [estado, setEstado] = useState<{ error?: string; ok?: boolean }>({});
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PUT('/api/profesionales/yo/datos-privados', {
          body: {
            rut: rutNormalizado(f.rut) || undefined,
            banco: (f.banco || undefined) as DatosPrivadosDto['banco'],
            tipoCuenta: (f.tipoCuenta || undefined) as DatosPrivadosDto['tipoCuenta'],
            numeroCuenta: f.numeroCuenta.trim() || undefined,
            titular: f.titular.trim() || undefined,
          },
        }),
      ),
    onSuccess: () => {
      setEstado({ ok: true });
      void cliente.invalidateQueries({ queryKey: ['equipo', 'privados'] });
    },
    onError: (e) => setEstado({ error: e instanceof ApiError ? e.message : 'No pudimos guardar tus datos.' }),
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (f.rut.trim() && !rutValido(f.rut)) return setEstado({ error: 'El RUT no es válido (revisa el dígito verificador).' });
    guardar.mutate();
  };
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoRut label="RUT" hint="También sirve para iniciar sesión." value={f.rut} onChange={(v) => setF((a) => ({ ...a, rut: v }))} />
        <Field label="Titular de la cuenta">{(x) => <Input {...x} value={f.titular} maxLength={120} onChange={cambiar('titular')} />}</Field>
        <Field label="Banco">
          {(x) => (
            <Select {...x} value={f.banco} onChange={cambiar('banco')}>
              <option value="">Elige un banco</option>
              {BANCOS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Tipo de cuenta">
          {(x) => (
            <Select {...x} value={f.tipoCuenta} onChange={cambiar('tipoCuenta')}>
              <option value="">Elige un tipo</option>
              {(Object.keys(CUENTAS) as (keyof typeof CUENTAS)[]).map((k) => (
                <option key={k} value={k}>
                  {CUENTAS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Número de cuenta">
          {(x) => <Input {...x} inputMode="numeric" value={f.numeroCuenta} maxLength={30} onChange={cambiar('numeroCuenta')} />}
        </Field>
      </div>
      {estado.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {estado.error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {estado.ok && (
          <p role="status" className="m-0 mr-auto text-[13px] font-bold text-accent-2-800">
            Datos guardados.
          </p>
        )}
        <Button type="submit" variant="team" icon="save" loading={guardar.isPending}>
          Guardar datos para pagos
        </Button>
      </div>
    </form>
  );
}

/** Calificaciones recibidas (con el feedback privado, solo visible para el profesional). */
export function MisResenas() {
  const resenas = useQuery({ queryKey: ['equipo', 'mis-resenas'], queryFn: () => datos(api.GET('/api/profesionales/yo/resenas')) });
  const publicadas = (resenas.data ?? []).filter((r) => r.estado === 'PUBLICADA');
  const promedio = publicadas.length ? publicadas.reduce((a, r) => a + r.calificacion, 0) / publicadas.length : null;
  return (
    <Panel
      titulo={
        <span className="inline-flex flex-wrap items-center gap-2.5">
          Mis calificaciones <Badge>Solo lectura</Badge>
        </span>
      }
      bajada="Son anónimas y no puedo editarlas ni eliminarlas. El comentario privado solo lo veo yo."
      accion={
        promedio !== null && (
          <span className="flex items-center gap-2.5 rounded-[18px] border border-divider bg-bg px-4 py-2">
            <span className="text-[30px] leading-none font-black tracking-[-0.04em] tabular-nums">{promedio.toFixed(1).replace('.', ',')}</span>
            <span className="flex flex-col gap-0.5">
              <Estrellas valor={Math.round(promedio)} />
              <span className="text-[12px] font-bold text-neutral-700">
                {publicadas.length} {publicadas.length === 1 ? 'calificación' : 'calificaciones'}
              </span>
            </span>
          </span>
        )
      }
    >
      <div className="mt-4">
        <EstadoConsulta consulta={resenas} vacio={(l) => l.length === 0} textoVacio="Todavía no recibes calificaciones">
          {(l) => (
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {l.map((r) => (
                <li key={r.id} className="rounded-[14px] border border-divider bg-bg px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Estrellas valor={r.calificacion} />
                    <span className="text-[12.5px] font-semibold text-neutral-700">{formatoFecha(r.creadaEn)}</span>
                    <Badge tono={r.estado === 'PUBLICADA' ? 'positivo' : 'neutro'} className="ml-auto">
                      {ESTADO_RESENA[r.estado]}
                    </Badge>
                  </div>
                  {r.texto && <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed text-neutral-800">{r.texto}</p>}
                  {r.feedbackPrivado && (
                    <p className="m-0 mt-2 rounded-[12px] border-[1.5px] border-dashed border-neutral-400 px-3 py-2 text-[13px] text-neutral-800">
                      <span className="font-extrabold">Comentario privado: </span>
                      {r.feedbackPrivado}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </EstadoConsulta>
      </div>
    </Panel>
  );
}
