'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { BarraFlotante, LIENZO, SeparadorBarra } from '@/components/ui/BarraFlotante';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Interruptor } from '@/components/ui/Interruptor';
import { Modal } from '@/components/ui/Modal';
import { PanelIncrustado } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { usePerfilProfesional, useTarifas, useTiposDeProfesional, useTrayectoria, type PerfilProfesional } from '@/lib/equipo';
import { useTiposAtencion } from '@/lib/panel';
import { NOMBRE_MODALIDAD, formacionBase, nombreCorto, textoCalificacion, textoTarifa } from '@/lib/perfiles';
import { subirArchivo } from '@/lib/subidas';
import { vistaPreviaPerfil } from '@/lib/vistaPreviaPerfil';

import { ContenidoPerfil } from './EquipoPublico';
import { MiTrayectoria, MisDeclaraciones, MisResenas, MisTarifas } from './MiPerfilProfesional';
import { RegistroSisPanel } from './RegistroSis';

type Seccion = 'cab' | 'reg' | 'dat' | 'fra' | 'sob' | 'for' | 'esp' | 'age' | 'val';

/** Secciones del perfil (diseño "Moderno A, inspector flotante"): nombre en el inspector y ayuda. */
const SECCIONES: Record<Seccion, { nombre: string; ayuda: string }> = {
  cab: { nombre: 'Nombre y foto', ayuda: 'Lo primero que ve el paciente. La calificación no se edita.' },
  reg: { nombre: 'Registro profesional', ayuda: 'Número de la Superintendencia de Salud. Si lo cambias, el sello se oculta hasta que se verifique.' },
  dat: { nombre: 'Tarifa y modalidad', ayuda: 'Una tarifa nueva rige solo para horas que se agenden desde ahora.' },
  fra: { nombre: 'Frase destacada', ayuda: 'Una frase sobre cómo trabajas.' },
  sob: { nombre: 'Sobre mí', ayuda: 'Tu enfoque en pocas líneas. Sin datos de contacto: los pacientes te escriben por el portal.' },
  for: { nombre: 'Formación', ayuda: 'Un título nuevo queda "En revisión" hasta que el centro revise su respaldo.' },
  esp: { nombre: 'Especialidades', ayuda: 'Del catálogo del centro; las aprueba la cuenta madre. También alimentan el match terapéutico.' },
  age: { nombre: 'Horas disponibles', ayuda: 'Esta tarjeta no se edita aquí: se arma con tus horarios y los boxes que apartas.' },
  val: { nombre: 'Valoraciones', ayuda: 'Las dejan pacientes que tuvieron al menos una sesión contigo. No se editan; puedes reportar una si no corresponde.' },
};
const ORDEN: Seccion[] = ['cab', 'reg', 'dat', 'fra', 'sob', 'for', 'esp', 'age', 'val'];
/** Secciones con campos del perfil (se guardan con "Guardar y publicar"); el resto guarda en su propio formulario. */
const CON_BORRADOR: Seccion[] = ['cab', 'dat', 'fra', 'sob', 'esp'];

interface Textos {
  nombrePublico: string;
  especialidad: string;
  modalidad: PerfilProfesional['modalidad'];
  citaDestacada: string;
  bio: string;
  enfoques: string;
  idiomas: string;
  convenios: string;
  boletaReembolsable: boolean;
}
const textosDe = (p: PerfilProfesional | null): Textos => ({
  nombrePublico: p?.nombrePublico ?? '',
  especialidad: p?.especialidad ?? '',
  modalidad: p?.modalidad ?? 'PRESENCIAL',
  citaDestacada: p?.citaDestacada ?? '',
  bio: p?.bio ?? '',
  enfoques: (p?.enfoques ?? []).join(', '),
  idiomas: (p?.idiomas ?? []).join(', '),
  convenios: (p?.convenios ?? []).join(', '),
  boletaReembolsable: p?.boletaReembolsable ?? false,
});
const lista = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const iguales = (a: Textos, b: Textos) => JSON.stringify(a) === JSON.stringify(b);

type Accion = { tipo: 'ir'; seccion: Seccion | null } | { tipo: 'paciente' };

/**
 * Mi perfil publico (diseño "Moderno A: lienzo claro con inspector
 * flotante"): el perfil tal como lo ve el paciente; cada parte se toca para
 * editarla en el inspector y el lienzo muestra el cambio en vivo. "Ver cómo me
 * ven los pacientes" muestra la pagina publica real (mismos componentes) con
 * lo guardado. Lo privado (contacto, seguridad, pagos) vive en Mi cuenta.
 */
export function EditorPerfil({ usuarioId, nombreCuenta, agenda }: { usuarioId: string; nombreCuenta: string; agenda: boolean }) {
  const perfil = usePerfilProfesional(usuarioId);
  return (
    <EstadoConsulta consulta={perfil}>
      {(p) => <Editor key={p?.updatedAt ?? 'nuevo'} usuarioId={usuarioId} nombreCuenta={nombreCuenta} perfil={p} agenda={agenda} />}
    </EstadoConsulta>
  );
}

function Editor({ usuarioId, nombreCuenta, perfil, agenda }: { usuarioId: string; nombreCuenta: string; perfil: PerfilProfesional | null; agenda: boolean }) {
  const cliente = useQueryClient();
  const base = useRef(textosDe(perfil));
  const [draft, setDraft] = useState<Textos>(base.current);
  const [sel, setSel] = useState<Seccion | null>(perfil ? null : 'cab');
  const [paciente, setPaciente] = useState(false);
  const [telefono, setTelefono] = useState(false);
  const [confirmar, setConfirmar] = useState<Accion | null>(null);
  const [error, setError] = useState<string>();
  const sucio = !iguales(draft, base.current);

  const trayectoria = useTrayectoria(usuarioId).data ?? [];
  const tarifas = useTarifas(usuarioId).data ?? [];
  const tipos = useTiposDeProfesional(usuarioId).data ?? [];
  const catalogo = useTiposAtencion().data ?? [];
  const registro = useQuery({
    queryKey: ['equipo', 'registro-sis', usuarioId],
    queryFn: () => datos(api.GET('/api/profesionales/{id}/registro-sis', { params: { path: { id: usuarioId } } })),
  }).data;
  const resenas = useQuery({ queryKey: ['equipo', 'mis-resenas'], queryFn: () => datos(api.GET('/api/profesionales/yo/resenas')) }).data ?? [];

  // En el lienzo se ve el borrador mientras se edita una seccion.
  const t = sel && !paciente ? draft : base.current;
  const vista = vistaPreviaPerfil({
    perfil: {
      ...(perfil ?? { usuarioId, fotoUrl: null, perfilPublico: false, cobroDirecto: false, margenTrasladoMin: null, perfilPublicoConsentidoEn: null }),
      nombrePublico: t.nombrePublico || null,
      especialidad: t.especialidad || 'Tu especialidad',
      modalidad: t.modalidad,
      citaDestacada: t.citaDestacada || null,
      bio: t.bio || null,
      enfoques: lista(t.enfoques),
      idiomas: lista(t.idiomas),
      convenios: lista(t.convenios),
      boletaReembolsable: t.boletaReembolsable,
    } as PerfilProfesional,
    nombreCuenta,
    trayectoria,
    registro: registro ?? null,
    tarifas,
    tipos,
    nombreTipo: new Map(catalogo.map((x) => [x.id, x.nombre])),
    resenas,
    ahora: Date.now(),
    anioActual: new Date().getFullYear(),
  });

  const cuerpo = (x: Textos, publico: boolean) => ({
    especialidad: x.especialidad.trim(),
    modalidad: x.modalidad,
    nombrePublico: x.nombrePublico.trim() || null,
    bio: x.bio.trim() || null,
    citaDestacada: x.citaDestacada.trim() || null,
    enfoques: lista(x.enfoques),
    idiomas: lista(x.idiomas),
    convenios: lista(x.convenios),
    boletaReembolsable: x.boletaReembolsable,
    cobroDirecto: perfil?.cobroDirecto ?? false,
    perfilPublico: publico,
  });
  const guardarPerfil = useMutation({
    mutationFn: (b: ReturnType<typeof cuerpo>) => datos(api.PUT('/api/profesionales/yo/perfil', { body: b })),
    onSuccess: (p) => {
      setError(undefined);
      cliente.setQueryData(['equipo', 'perfil', usuarioId], p);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar tu perfil.'),
  });

  const ejecutar = (a: Accion) => {
    setDraft(base.current);
    setConfirmar(null);
    setError(undefined);
    if (a.tipo === 'ir') setSel(a.seccion);
    else {
      setSel(null);
      setPaciente((v) => !v);
    }
  };
  const pedir = (a: Accion) => (sucio ? setConfirmar(a) : ejecutar(a));
  const elegir = (s: Seccion) => {
    if (paciente || sel === s) return;
    pedir({ tipo: 'ir', seccion: s });
  };
  const guardar = () => {
    if (draft.especialidad.trim().length < 2) return setError('Escribe tu especialidad principal (por ejemplo, Psicología clínica adultos).');
    if (draft.nombrePublico.trim().length === 1) return setError('El nombre que se muestra necesita al menos 2 letras.');
    guardarPerfil.mutate(cuerpo(draft, perfil?.perfilPublico ?? false), { onSuccess: () => setSel(null) });
  };

  const estado = sucio
    ? { texto: 'Cambios sin guardar', tono: 'atencion' as const }
    : perfil?.perfilPublico
      ? { texto: 'Publicado', tono: 'positivo' as const }
      : { texto: 'Sin publicar', tono: 'neutro' as const };
  const bloque = (s: Seccion) => ({ s, sel, paciente, onElegir: () => elegir(s) });

  return (
    <div className={`${LIENZO} -mx-[clamp(12px,2vw,24px)] flex flex-col gap-[18px] px-[clamp(12px,2vw,24px)] pt-4 pb-10`}>
      <BarraFlotante etiqueta="Mi perfil">
        <strong className="text-[15px] font-black">Mi perfil</strong>
        <Badge tono={estado.tono}>{estado.texto}</Badge>
        <SeparadorBarra />
        <div role="group" aria-label="Tamaño de la vista" className="flex gap-0.5 rounded-full bg-neutral-200 p-[3px]">
          {[
            { v: false, l: 'Computador' },
            { v: true, l: 'Teléfono' },
          ].map((o) => (
            <button
              key={o.l}
              type="button"
              aria-pressed={telefono === o.v}
              onClick={() => setTelefono(o.v)}
              className={`min-h-[34px] cursor-pointer rounded-full px-3 text-[12px] font-extrabold ${telefono === o.v ? 'bg-bg shadow-sm' : 'hover:bg-neutral-100'}`}
            >
              {o.l}
            </button>
          ))}
        </div>
        <Button variant={paciente ? 'primary' : 'team'} aria-pressed={paciente} onClick={() => pedir({ tipo: 'paciente' })} className="!min-h-10 !py-2">
          {paciente ? 'Volver a editar' : 'Ver cómo me ven los pacientes'}
        </Button>
        {agenda && (
          <ButtonLink href="/admin/agenda" variant="ghost" className="!min-h-10 !py-2">
            Ver mi agenda
          </ButtonLink>
        )}
        <ButtonLink href="/equipo" variant="ghost" className="!min-h-10 !py-2">
          Ver el equipo
        </ButtonLink>
        <ButtonLink href="/admin/perfil/cuenta" variant="secondary" icon="lock" className="!min-h-10 !py-2">
          Mi cuenta
        </ButtonLink>
      </BarraFlotante>

      {paciente ? (
        <VistaPaciente perfil={vista} agenda={agenda} telefono={telefono} />
      ) : (
        <div className="relative flex flex-wrap items-start justify-center gap-[22px]">
          {sel && (
            // Tocar fuera del perfil quita la seleccion (con teclado: "Cerrar editor" o Descartar).
            <button
              type="button"
              tabIndex={-1}
              aria-label="Quitar la selección"
              onClick={() => pedir({ tipo: 'ir', seccion: null })}
              className="absolute inset-0 z-0 cursor-default"
            />
          )}
          <article
            aria-label="Vista previa de mi perfil público"
            className={`relative z-[1] flex min-w-0 flex-[999_1_560px] flex-wrap items-start gap-[26px] rounded-[28px] bg-neutral-100 p-[clamp(18px,3vw,34px)] shadow-lg ${
              telefono ? 'max-w-[420px]' : 'max-w-[900px]'
            }`}
          >
            <div className="flex min-w-0 flex-[999_1_360px] flex-col gap-[18px]">
              <Bloque {...bloque('cab')} className="flex items-center gap-[18px] rounded-[20px] p-3.5">
                <AvatarProfesional nombre={vista.nombre_publico ?? nombreCuenta} foto={vista.foto_url} size={92} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[clamp(26px,3.4vw,36px)] leading-[1.05] font-black tracking-[-0.03em] text-balance">
                    {vista.nombre_publico ?? nombreCuenta}
                  </span>
                  <span className="font-bold text-neutral-800">{vista.especialidad}</span>
                  <span className="text-[13px] font-semibold text-neutral-800">{formacionBase(vista) ?? 'Tu título verificado aparece aquí'}</span>
                </span>
              </Bloque>

              <Bloque {...bloque('reg')} className="flex flex-wrap items-center gap-2.5 rounded-[16px] px-3.5 py-3">
                <span className="rounded-full border border-accent-2-600 bg-accent-2-100 px-3 py-[5px] text-[13px] font-extrabold text-accent-2-900">
                  {registro?.numero ? `Registro SIS N.° ${registro.numero}` : 'Sin registro SIS'}
                </span>
                <span className="text-[13px] font-semibold text-neutral-800">{textoRegistro(registro)}</span>
                <span className="text-[13px] font-semibold text-neutral-800">
                  {textoCalificacion(vista) ? (
                    <>
                      <strong className="text-accent-700">{textoCalificacion(vista)}</strong> ({vista.resenas}{' '}
                      {vista.resenas === 1 ? 'valoración' : 'valoraciones'})
                    </>
                  ) : (
                    'Sin valoraciones aún'
                  )}
                </span>
              </Bloque>

              <Bloque {...bloque('dat')} className="flex flex-wrap items-center gap-2 rounded-[16px] px-3.5 py-3">
                <Pastilla>{textoTarifa(vista) ?? 'Sin tarifa'}</Pastilla>
                <Pastilla>{NOMBRE_MODALIDAD[vista.modalidad]}</Pastilla>
                {vista.anios_experiencia !== null && vista.anios_experiencia > 0 && (
                  <Pastilla>
                    {vista.anios_experiencia} {vista.anios_experiencia === 1 ? 'año' : 'años'} de experiencia
                  </Pastilla>
                )}
              </Bloque>

              <Bloque {...bloque('fra')} className="flex gap-2.5 rounded-[22px] !bg-accent-200 px-6 py-[22px]">
                <span aria-hidden className="text-[40px] leading-[0.8] font-black text-accent-700">
                  &ldquo;
                </span>
                <span className={`flex-1 text-[21px] leading-[1.3] font-extrabold ${vista.cita_destacada ? '' : 'text-neutral-700'}`}>
                  {vista.cita_destacada ?? 'Agrega una frase sobre cómo trabajas.'}
                </span>
              </Bloque>

              <Bloque {...bloque('sob')} className="flex flex-col gap-1.5 rounded-[16px] p-3.5">
                <Rotulo>Sobre mí</Rotulo>
                <span className={`text-[15px] whitespace-pre-line ${vista.bio ? '' : 'text-neutral-700'}`}>
                  {vista.bio ?? 'Cuenta tu enfoque en pocas líneas.'}
                </span>
              </Bloque>

              <Bloque {...bloque('for')} className="flex flex-col gap-2 rounded-[16px] p-3.5">
                <Rotulo>Formación verificada</Rotulo>
                {vista.trayectoria.length === 0 && <span className="text-[13.5px] font-semibold text-neutral-700">Sin formación verificada todavía.</span>}
                {vista.trayectoria.map((x) => (
                  <span key={`${x.titulo}-${x.anio}`} className="flex flex-col rounded-[14px] bg-bg px-3.5 py-3">
                    <strong>{x.titulo}</strong>
                    <span className="text-[12px] font-semibold text-neutral-700">
                      {x.institucion} · {x.anio}
                    </span>
                  </span>
                ))}
                {trayectoria.some((x) => !x.verificado) && (
                  <span className="text-[12px] font-bold text-neutral-700">
                    {trayectoria.filter((x) => !x.verificado).length} en revisión (no se publican aún)
                  </span>
                )}
              </Bloque>

              <Bloque {...bloque('esp')} className="flex flex-col gap-2 rounded-[16px] p-3.5">
                <Rotulo>Especialidades y atención</Rotulo>
                <span className="flex flex-wrap gap-2">
                  {[...vista.tipos_atencion, ...vista.enfoques].map((c) => (
                    <span key={c} className="rounded-full bg-accent-2-200 px-3.5 py-[7px] text-[13px] font-extrabold text-accent-2-900">
                      {c}
                    </span>
                  ))}
                  {vista.tipos_atencion.length + vista.enfoques.length === 0 && (
                    <span className="text-[13.5px] font-semibold text-neutral-700">Declara tus especialidades y enfoques.</span>
                  )}
                </span>
              </Bloque>
            </div>

            <div className="flex max-w-[250px] min-w-[200px] flex-[1_1_210px] flex-col gap-3.5">
              {agenda && (
                <Bloque {...bloque('age')} className="flex flex-col gap-2 rounded-[22px] !bg-accent-2-900 p-[18px] text-accent-2-100">
                  <strong className="pr-8 text-[17px] font-black text-accent-2-100">Agenda con {nombreCorto(vista)}</strong>
                  <span className="text-[12px] font-semibold text-accent-2-200">Mira sus horas libres y reserva sin crear una cuenta.</span>
                  <span className="flex min-h-[42px] items-center justify-center rounded-full bg-accent-2-100 text-[13px] font-extrabold text-accent-2-900">
                    Ver horas disponibles
                  </span>
                </Bloque>
              )}
              <Bloque {...bloque('val')} className="flex flex-col gap-1.5 rounded-[22px] !bg-bg p-[18px]">
                <strong className="text-[17px] font-black">Valoraciones{textoCalificacion(vista) ? ` · ${textoCalificacion(vista)}` : ''}</strong>
                <span className="text-[12px] font-semibold text-neutral-800">{primeraValoracion(resenas)}</span>
              </Bloque>
            </div>
          </article>

          <Inspector
            sel={sel}
            perfil={perfil}
            usuarioId={usuarioId}
            draft={draft}
            setDraft={setDraft}
            sucio={sucio}
            error={error}
            guardando={guardarPerfil.isPending}
            onGuardar={guardar}
            onCerrar={() => ejecutar({ tipo: 'ir', seccion: null })}
            onElegir={elegir}
            onPublicar={(v) => guardarPerfil.mutate(cuerpo(base.current, v))}
            nombreCuenta={nombreCuenta}
          />
        </div>
      )}

      <Modal
        abierto={!!confirmar}
        onCerrar={() => setConfirmar(null)}
        titulo={`Estás modificando "${sel ? SECCIONES[sel].nombre : ''}"`}
        descripcion="¿Seguro que quieres descartar los cambios? Lo que escribiste no se publicará."
        acciones={
          <>
            <Button variant="secondary" onClick={() => confirmar && ejecutar(confirmar)}>
              Sí, descartar
            </Button>
            <Button variant="team" onClick={() => setConfirmar(null)}>
              No, seguir editando
            </Button>
          </>
        }
      />
    </div>
  );
}

function textoRegistro(r: components['schemas']['RegistroSisVista'] | undefined): string {
  if (!r || r.estado === 'NO_INFORMADO') return 'Agrégalo para mostrar el sello';
  if (r.estado === 'VERIFICADO_AUTOMATICO' || r.estado === 'VERIFICADO_MANUAL') return 'Verificado';
  if (r.estado === 'NO_COINCIDE') return 'No coincide: revísalo';
  return 'Pendiente de verificación';
}

function primeraValoracion(resenas: components['schemas']['MiResenaRecibida'][]): string {
  const r = resenas.find((x) => x.estado === 'PUBLICADA' && x.texto);
  if (r) return `"${r.texto}"`;
  return resenas.some((x) => x.estado === 'PUBLICADA') ? 'Valoraciones sin comentario.' : 'Todavía no tienes valoraciones publicadas.';
}

const Rotulo = ({ children }: { children: ReactNode }) => (
  <span className="text-[11px] font-extrabold tracking-[0.12em] text-neutral-700 uppercase">{children}</span>
);
const Pastilla = ({ children }: { children: ReactNode }) => (
  <span className="rounded-full border border-divider bg-bg px-3.5 py-2 text-[13px] font-extrabold">{children}</span>
);

/** Parte del perfil que se toca para editar: anillo al elegirla, el resto se atenua. */
function Bloque({
  s,
  sel,
  paciente,
  onElegir,
  className,
  children,
}: {
  s: Seccion;
  sel: Seccion | null;
  paciente: boolean;
  onElegir: () => void;
  className: string;
  children: ReactNode;
}) {
  const activo = sel === s && !paciente;
  const otro = !!sel && !activo;
  return (
    <button
      type="button"
      aria-pressed={activo}
      aria-label={`Editar ${SECCIONES[s].nombre}`}
      onClick={onElegir}
      className={`relative w-full cursor-pointer pr-12 text-left text-text transition-[opacity,filter] duration-200 motion-reduce:transition-none ${
        activo ? 'bg-bg outline-3 outline-offset-4 outline-accent-700' : 'hover:bg-bg/70'
      } ${otro ? 'opacity-[0.32] blur-[1.5px] grayscale-[0.4]' : ''} ${className}`}
    >
      {activo && (
        <span className="absolute -top-4 left-4 rounded-full bg-accent-700 px-2.5 py-[3px] text-[11px] font-extrabold text-neutral-100">
          Editando · {SECCIONES[s].nombre}
        </span>
      )}
      {!sel && (
        <span aria-hidden className="absolute top-2.5 right-2.5 grid size-[30px] place-items-center rounded-full border border-divider bg-bg text-accent-700">
          <Icon name="edit" size={14} />
        </span>
      )}
      {children}
    </button>
  );
}

function VistaPaciente({ perfil, agenda, telefono }: { perfil: ReturnType<typeof vistaPreviaPerfil>; agenda: boolean; telefono: boolean }) {
  const resenas = useQuery({
    queryKey: ['publico', 'resenas', perfil.id],
    queryFn: () => datos(api.GET('/api/publico/profesionales/{id}/resenas', { params: { path: { id: perfil.id } } })),
  });
  return (
    <section
      aria-label="Así ven mi perfil los pacientes"
      className={`mx-auto w-full rounded-[28px] bg-bg p-[clamp(18px,3vw,34px)] shadow-lg ${telefono ? 'max-w-[420px]' : 'max-w-[1140px]'}`}
    >
      <p className="m-0 mb-4 flex items-center gap-2 text-[13px] font-bold text-neutral-700">
        <Icon name="visibility" size={16} />
        {perfil.verificado || perfil.tarifas.length ? 'Así se ve tu página en el sitio del centro.' : 'Así se verá tu página en el sitio del centro.'}
      </p>
      <ContenidoPerfil perfil={perfil} resenas={resenas.data ?? []} agenda={agenda} />
    </section>
  );
}

function Inspector({
  sel,
  perfil,
  usuarioId,
  draft,
  setDraft,
  sucio,
  error,
  guardando,
  onGuardar,
  onCerrar,
  onElegir,
  onPublicar,
  nombreCuenta,
}: {
  sel: Seccion | null;
  perfil: PerfilProfesional | null;
  usuarioId: string;
  draft: Textos;
  setDraft: (f: (t: Textos) => Textos) => void;
  sucio: boolean;
  error?: string;
  guardando: boolean;
  onGuardar: () => void;
  onCerrar: () => void;
  onElegir: (s: Seccion) => void;
  onPublicar: (v: boolean) => void;
  nombreCuenta: string;
}) {
  const campo = (k: keyof Textos) => (e: { target: { value: string } }) => setDraft((t) => ({ ...t, [k]: e.target.value }));
  return (
    <aside
      aria-label="Editor del perfil"
      className="relative z-[1] flex max-w-[380px] min-w-0 flex-[1_1_320px] flex-col gap-3.5 self-start rounded-[24px] border border-divider bg-bg/95 p-5 shadow-lg backdrop-blur-[10px] lg:sticky lg:top-[84px]"
    >
      {!sel ? (
        <>
          <span className="text-[11px] font-extrabold tracking-[0.12em] text-accent-700 uppercase">Editor</span>
          <h2 className="m-0 text-[22px] leading-tight font-black tracking-[-0.02em]">Toca cualquier parte de tu perfil para editarla</h2>
          <p className="m-0 text-[13px] font-semibold text-neutral-700">El diseño es el mismo para todo el centro. Tú cambias el contenido y lo ves en vivo.</p>
          <div className="flex flex-wrap gap-1.5">
            {ORDEN.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onElegir(s)}
                className={`min-h-[34px] cursor-pointer rounded-full border border-divider px-3 text-[12px] font-extrabold hover:border-accent-500 ${
                  CON_BORRADOR.includes(s) ? 'bg-bg' : 'bg-neutral-200 text-neutral-800'
                }`}
              >
                {SECCIONES[s].nombre}
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-divider pt-4">
            <Interruptor
              tono="team"
              etiqueta="Publicar mi perfil en la página del centro"
              descripcion="Solo tú decides publicarlo. Necesitas una tarifa general vigente (en Tarifa y modalidad)."
              activo={perfil?.perfilPublico ?? false}
              deshabilitado={!perfil || guardando}
              onChange={onPublicar}
            />
            {perfil?.perfilPublico && (
              <Link href={`/equipo/${usuarioId}`} target="_blank" className="mt-3 inline-flex items-center gap-1 text-[13px] font-extrabold text-accent-700">
                Abrir mi página pública
                <Icon name="open_in_new" size={14} label="(se abre en otra pestaña)" />
              </Link>
            )}
          </div>
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="grid size-9 place-items-center rounded-[12px] bg-accent-700 text-neutral-100">
              <Icon name="edit" size={16} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[11px] font-extrabold tracking-[0.12em] text-accent-700 uppercase">Editando</span>
              <h2 className="m-0 text-[20px] font-black tracking-[-0.02em]">{SECCIONES[sel].nombre}</h2>
            </div>
            <button
              type="button"
              aria-label="Cerrar editor"
              onClick={onCerrar}
              className="grid size-10 cursor-pointer place-items-center rounded-full border border-divider bg-bg hover:bg-accent-200"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <p className="m-0 text-[13px] font-semibold text-neutral-700">{SECCIONES[sel].ayuda}</p>

          <PanelIncrustado.Provider value>
            {sel === 'cab' && (
              <>
                <Foto usuarioId={usuarioId} existe={!!perfil} />
                <Field label="Nombre que se muestra" hint={`Vacío: se usa el nombre de tu cuenta (${nombreCuenta}).`}>
                  {(x) => <Input {...x} value={draft.nombrePublico} maxLength={120} onChange={campo('nombrePublico')} />}
                </Field>
                <Field label="Especialidad principal" required>
                  {(x) => <Input {...x} value={draft.especialidad} maxLength={120} onChange={campo('especialidad')} />}
                </Field>
                <p className="m-0 text-[12px] font-semibold text-neutral-700">El título bajo tu nombre sale de tu título verificado más antiguo (Formación).</p>
              </>
            )}
            {sel === 'reg' && <RegistroSisPanel profesionalId={usuarioId} practicante={false} propio admin={false} />}
            {sel === 'dat' && (
              <>
                <Field label="Modalidad">
                  {(x) => (
                    <Select {...x} value={draft.modalidad} onChange={(e) => setDraft((t) => ({ ...t, modalidad: e.target.value as Textos['modalidad'] }))}>
                      {(Object.keys(NOMBRE_MODALIDAD) as Textos['modalidad'][]).map((m) => (
                        <option key={m} value={m}>
                          {NOMBRE_MODALIDAD[m]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Convenios" hint="Separados por coma. Filtran el match por previsión.">
                  {(x) => <Input {...x} value={draft.convenios} onChange={campo('convenios')} placeholder="Fonasa, Isapre" />}
                </Field>
                <Interruptor
                  tono="team"
                  etiqueta="Boleta reembolsable"
                  descripcion="Se indica en tu perfil para pacientes con isapre o seguro."
                  activo={draft.boletaReembolsable}
                  onChange={(v) => setDraft((t) => ({ ...t, boletaReembolsable: v }))}
                />
                <p className="m-0 text-[12px] font-semibold text-neutral-700">Los años de experiencia salen de tu título verificado más antiguo.</p>
                <div className="border-t border-divider pt-3">
                  <MisTarifas usuarioId={usuarioId} />
                </div>
              </>
            )}
            {sel === 'fra' && (
              <Field label="Frase" aside={`${draft.citaDestacada.length} / 300`}>
                {(x) => <Textarea {...x} rows={3} maxLength={300} value={draft.citaDestacada} onChange={campo('citaDestacada')} />}
              </Field>
            )}
            {sel === 'sob' && (
              <Field label="Sobre mí" aside={`${draft.bio.length} / 2000`} hint="Separa los párrafos con una línea en blanco.">
                {(x) => <Textarea {...x} rows={8} maxLength={2000} value={draft.bio} onChange={campo('bio')} />}
              </Field>
            )}
            {sel === 'for' && <MiTrayectoria usuarioId={usuarioId} />}
            {sel === 'esp' && (
              <>
                <Field label="Enfoques" hint="Separados por coma.">
                  {(x) => <Input {...x} value={draft.enfoques} onChange={campo('enfoques')} placeholder="Cognitivo-conductual, sistémico" />}
                </Field>
                <Field label="Idiomas" hint="Separados por coma.">
                  {(x) => <Input {...x} value={draft.idiomas} onChange={campo('idiomas')} placeholder="Español, inglés" />}
                </Field>
                <div className="border-t border-divider pt-3">
                  <MisDeclaraciones usuarioId={usuarioId} />
                </div>
              </>
            )}
            {sel === 'age' && (
              <div className="flex flex-col gap-2 rounded-[14px] bg-neutral-200 p-3.5 text-[13px] font-semibold text-neutral-800">
                <span>Las horas que ven los pacientes salen de tus horarios y de los boxes que apartas.</span>
                <Link href="/admin/agenda" className="font-extrabold text-accent-700">
                  Ir a mi agenda
                </Link>
                <Link href="/admin/agenda?vista=horarios" className="font-extrabold text-accent-700">
                  Mis horarios y boxes
                </Link>
              </div>
            )}
            {sel === 'val' && <MisResenas />}
          </PanelIncrustado.Provider>

          {sucio && (
            <p role="alert" className="m-0 rounded-[14px] border border-pendiente-700 bg-pendiente-100 px-3.5 py-3 text-[13px] font-bold text-pendiente-900">
              Tienes cambios sin guardar aquí. Guárdalos o descártalos antes de pasar a otra sección.
            </p>
          )}
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
          {CON_BORRADOR.includes(sel) && (
            <div className="flex gap-2 pt-1.5">
              <Button variant="team" disabled={!sucio && !!perfil} loading={guardando} onClick={onGuardar} className="flex-1">
                {!perfil ? 'Crear mi perfil' : sucio ? (perfil.perfilPublico ? 'Guardar y publicar' : 'Guardar') : 'Sin cambios'}
              </Button>
              <Button variant="secondary" onClick={onCerrar}>
                Descartar
              </Button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

/** Foto del perfil publico: se sube al elegirla (JPEG, PNG o WebP; sin metadatos). */
function Foto({ usuarioId, existe }: { usuarioId: string; existe: boolean }) {
  const cliente = useQueryClient();
  const archivo = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const subir = useMutation({
    mutationFn: (a: File) => subirArchivo<{ fotoUrl: string }>('/api/profesionales/yo/foto', 'imagen', a),
    onSuccess: () => {
      setError(undefined);
      void cliente.invalidateQueries({ queryKey: ['equipo', 'perfil', usuarioId] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos subir la foto.'),
  });
  if (!existe) return <p className="m-0 text-[12px] font-semibold text-neutral-700">Crea tu perfil para poder subir una foto.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={archivo}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Elegir foto de perfil"
        onChange={(e) => {
          const a = e.target.files?.[0];
          if (a) subir.mutate(a);
          e.target.value = '';
        }}
      />
      <Button variant="secondary" icon="photo_camera" loading={subir.isPending} onClick={() => archivo.current?.click()} className="self-start">
        Cambiar foto
      </Button>
      <span className="text-[11.5px] font-semibold text-neutral-700">JPEG, PNG o WebP. Se publica sin metadatos.</span>
      {error && (
        <span role="alert" className="text-[12.5px] font-bold text-accent-700">
          {error}
        </span>
      )}
    </div>
  );
}
