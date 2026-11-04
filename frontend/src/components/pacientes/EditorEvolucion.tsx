'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

import { EscalaDiez } from '@/components/shared/EscalaDiez';
import { ADVERTENCIA_TEXTO_LIBRE, FormularioDinamico, faltantes, type ValoresPlantilla } from '@/components/shared/FormularioDinamico';
import { Button } from '@/components/ui/Button';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import {
  NIVEL_RIESGO,
  useEstadosAvance,
  useIntervenciones,
  usePlantillasAplicables,
  useTiposSesion,
  type AdjuntoFicha,
  type BorradorVista,
  type EvolucionVista,
  type NivelRiesgo,
} from '@/lib/fichas';
import { formatoFechaLarga, formatoHora } from '@/lib/formato';
import type { Icono } from '@/lib/iconos';
import { aplicarFormato, separarNotas, unirNotas, type Formato } from '@/lib/notasEvolucion';
import type { CitaVista } from '@/lib/panel';
import { subirArchivo } from '@/lib/subidas';

const MAX_NOTAS = 20_000;
const ESPERA_GUARDADO = 1200;

type EstadoGuardado = 'vacio' | 'pendiente' | 'guardando' | 'guardado' | 'error';

interface Estructurados {
  tipoSesionId: string;
  nivelRiesgo: NivelRiesgo | '';
  estadoAvanceId: string;
  intervencionIds: string[];
}

type Bloque =
  | { id: number; tipo: 'escala'; nombre: string; valor?: number }
  | { id: number; tipo: 'tarea'; texto: string }
  | { id: number; tipo: 'recordatorio' }
  | { id: number; tipo: 'adjunto'; nombre: string; bytes: number };

const OPCIONES: { tipo: Bloque['tipo']; sigla: string; nombre: string; desc: string }[] = [
  { tipo: 'escala', sigla: '1-10', nombre: 'Escala', desc: 'Ánimo, ansiedad u otra medida' },
  { tipo: 'tarea', sigla: 'Ta', nombre: 'Tarea acordada', desc: 'Queda en la evolución y se ve al escribir la próxima' },
  { tipo: 'recordatorio', sigla: 'Re', nombre: 'Recordatorio para mí', desc: 'Va a Mis recordatorios, no al expediente' },
  { tipo: 'adjunto', sigla: 'Ad', nombre: 'Adjunto', desc: 'PDF o imagen, se cifra al subir' },
];
const ETIQUETA: Record<Bloque['tipo'], string> = {
  escala: 'ESCALA',
  tarea: 'TAREA ACORDADA',
  recordatorio: 'RECORDATORIO PERSONAL',
  adjunto: 'ADJUNTO',
};
const HERRAMIENTAS: { formato: Formato; etiqueta: string; marca?: string; clase?: string; icono?: Icono }[] = [
  { formato: 'negrita', etiqueta: 'Negrita', marca: 'B', clase: 'font-extrabold' },
  { formato: 'cursiva', etiqueta: 'Cursiva', marca: 'I', clase: 'font-semibold italic' },
  { formato: 'subrayado', etiqueta: 'Subrayado', marca: 'U', clase: 'font-semibold underline' },
  { formato: 'titulo', etiqueta: 'Título de sección', marca: 'H', clase: 'font-bold' },
  { formato: 'lista', etiqueta: 'Lista con viñetas', icono: 'format_list_bulleted' },
  { formato: 'numerada', etiqueta: 'Lista numerada', icono: 'format_list_numbered' },
  { formato: 'cita', etiqueta: 'Cita', icono: 'format_quote' },
];
const CHIP = '!min-h-9 !w-auto !max-w-full !rounded-full !bg-surface !py-1 !text-[13px] !font-bold';

interface EditorEvolucionProps {
  fichaId: string;
  pacienteId: string;
  /** Sesiones realizadas sin evolucion (para elegir cual se cierra). */
  sesiones: readonly CitaVista[];
  borrador?: BorradorVista;
  citaInicial?: string;
  /** Correccion: registro nuevo que apunta a este (no pasa por borrador). */
  corrige?: EvolucionVista;
  onListo: () => void;
  /** "Guardar como borrador": el archivo muestra su pila. */
  onBorradorGuardado: () => void;
}

/**
 * Nueva evolucion (diseño "Evoluciones: editor y archivo", borrador con
 * guardado automatico) o correccion de una evolucion propia. El borrador
 * guarda notas, sesion, plantilla, valores y riesgo. El riesgo se confirma
 * igual en "Confirmar en el expediente", junto con el tipo de sesion (ausente
 * del borrador), porque desde ahi el registro ya no se edita (solo se corrige
 * con uno nuevo). Titulo, escalas y tareas viajan dentro de las notas
 * (lib/notasEvolucion). Recordatorio y adjunto se guardan al momento en su
 * propio lugar: no forman parte del texto.
 */
export function EditorEvolucion({ fichaId, pacienteId, sesiones, borrador, citaInicial, corrige, onListo, onBorradorGuardado }: EditorEvolucionProps) {
  const cliente = useQueryClient();
  const plantillas = usePlantillasAplicables('EVOLUCION');
  const [inicial] = useState(() => separarNotas(corrige?.notas ?? borrador?.contenido ?? ''));
  const [titulo, setTitulo] = useState(inicial.titulo);
  const [cuerpo, setCuerpo] = useState(inicial.cuerpo);
  const siguienteBloque = useRef(inicial.escalas.length + inicial.tareas.length);
  const [bloques, setBloques] = useState<Bloque[]>([
    ...inicial.escalas.map((e, id): Bloque => ({ id, tipo: 'escala', nombre: e.nombre, valor: e.valor })),
    ...inicial.tareas.map((texto, i): Bloque => ({ id: inicial.escalas.length + i, tipo: 'tarea', texto })),
  ]);
  const [menu, setMenu] = useState(false);
  const [avisoBorrador, setAvisoBorrador] = useState(false);
  const [errorAdjunto, setErrorAdjunto] = useState<string>();
  const areaNotas = useRef<HTMLTextAreaElement>(null);
  const entradaArchivo = useRef<HTMLInputElement>(null);
  const primeraOpcion = useRef<HTMLButtonElement>(null);
  const notas = unirNotas({
    titulo,
    cuerpo,
    escalas: bloques.flatMap((b) => (b.tipo === 'escala' && b.valor && b.nombre.trim() ? [{ nombre: b.nombre.trim(), valor: b.valor }] : [])),
    tareas: bloques.flatMap((b) => (b.tipo === 'tarea' && b.texto.trim() ? [b.texto.trim()] : [])),
  });
  const [citaId, setCitaId] = useState(corrige ? '' : (borrador?.citaId ?? citaInicial ?? ''));
  const [plantillaId, setPlantillaId] = useState(corrige?.plantilla?.id ?? borrador?.plantillaId ?? '');
  const [valores, setValores] = useState<ValoresPlantilla>((corrige?.valores ?? borrador?.valores ?? {}) as ValoresPlantilla);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState(false);
  const [descartar, setDescartar] = useState(false);
  const [estructurados, setEstructurados] = useState<Estructurados>({
    tipoSesionId: corrige?.tipoSesion?.id ?? '',
    nivelRiesgo: corrige?.nivelRiesgo ?? borrador?.nivelRiesgo ?? '',
    estadoAvanceId: corrige?.estadoAvance?.id ?? '',
    intervencionIds: corrige?.intervenciones.map((i) => i.id) ?? [],
  });

  // La plantilla de una correccion es la del registro corregido (la BD lo exige).
  const plantilla = corrige?.plantilla ?? plantillas.lista.find((p) => p.id === plantillaId);
  const campos = plantilla?.definicion ?? [];
  // El aviso de texto libre ya acompaña a esos campos de la plantilla: en las notas no se repite entero.
  const avisoEnPlantilla = campos.some((c) => c.es_texto_libre);

  // --- Guardado automatico del borrador (no aplica a una correccion) ---
  const idBorrador = useRef(borrador?.id);
  const ultimoGuardado = useRef(
    borrador
      ? JSON.stringify(
          cuerpoBorrador(
            borrador.contenido,
            borrador.citaId ?? '',
            borrador.plantillaId ?? '',
            (borrador.valores ?? {}) as ValoresPlantilla,
            borrador.nivelRiesgo ?? '',
          ),
        )
      : '',
  );
  const cola = useRef<Promise<void>>(Promise.resolve());
  const [guardado, setGuardado] = useState<EstadoGuardado>(borrador ? 'guardado' : 'vacio');
  const [errorGuardado, setErrorGuardado] = useState<string>();

  const persistir = (cuerpo: ReturnType<typeof cuerpoBorrador>) => {
    const json = JSON.stringify(cuerpo);
    cola.current = cola.current.then(async () => {
      if (json === ultimoGuardado.current) return;
      setGuardado('guardando');
      try {
        const b = idBorrador.current
          ? await datos(api.PUT('/api/borradores/{id}', { params: { path: { id: idBorrador.current } }, body: cuerpo }))
          : await datos(api.POST('/api/fichas/{fichaId}/borradores', { params: { path: { fichaId } }, body: cuerpo }));
        idBorrador.current = b.id;
        ultimoGuardado.current = json;
        setGuardado('guardado');
        setErrorGuardado(undefined);
        void cliente.invalidateQueries({ queryKey: ['borradores'] });
      } catch (e) {
        setGuardado('error');
        setErrorGuardado(e instanceof ApiError ? e.message : 'No pudimos guardar el borrador. Revisa tu conexión.');
      }
    });
    return cola.current;
  };

  useEffect(() => {
    if (corrige) return;
    if (!notas.trim()) {
      setGuardado(idBorrador.current ? 'pendiente' : 'vacio');
      return;
    }
    const cuerpo = cuerpoBorrador(notas, citaId, plantillaId, valores, estructurados.nivelRiesgo);
    if (JSON.stringify(cuerpo) === ultimoGuardado.current) return;
    setGuardado('pendiente');
    const t = setTimeout(() => void persistir(cuerpo), ESPERA_GUARDADO);
    return () => clearTimeout(t);
    // persistir usa refs: solo los datos del borrador disparan el guardado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notas, citaId, plantillaId, valores, estructurados.nivelRiesgo, corrige]);

  const tipos = useTiposSesion('APROBADO');
  const estados = useEstadosAvance();
  const intervenciones = useIntervenciones();

  const invalidar = () => {
    void cliente.invalidateQueries({ queryKey: ['panel', 'evoluciones', fichaId] });
    void cliente.invalidateQueries({ queryKey: ['borradores'] });
    void cliente.invalidateQueries({ queryKey: ['panel', 'estado-fichas'] });
    void cliente.invalidateQueries({ queryKey: ['panel', 'dashboard'] });
  };

  const registrar = useMutation({
    mutationFn: async () => {
      const e = estructurados;
      const campos = {
        tipoSesionId: e.tipoSesionId,
        nivelRiesgo: e.nivelRiesgo as NivelRiesgo,
        estadoAvanceId: e.estadoAvanceId || undefined,
        intervencionIds: e.intervencionIds.length ? e.intervencionIds : undefined,
      };
      if (corrige) {
        return datos(
          api.POST('/api/fichas/{fichaId}/evoluciones', {
            params: { path: { fichaId } },
            body: { ...campos, notas: notas.trim(), corrigeAId: corrige.id, plantillaId: plantilla?.id, valores: plantilla ? valores : undefined },
          }),
        );
      }
      // Lo ultimo escrito queda en el borrador antes de confirmarlo.
      await persistir(cuerpoBorrador(notas, citaId, plantillaId, valores, e.nivelRiesgo));
      if (!idBorrador.current) throw new Error('sin-borrador');
      return datos(api.POST('/api/borradores/{id}/confirmacion', { params: { path: { id: idBorrador.current } }, body: campos }));
    },
    onSuccess: () => {
      invalidar();
      onListo();
    },
  });

  const subir = useMutation({
    mutationFn: (archivo: File) => subirArchivo<AdjuntoFicha>(`/api/pacientes/${pacienteId}/adjuntos`, 'archivo', archivo),
    onSuccess: (a) => {
      setErrorAdjunto(undefined);
      agregar({ tipo: 'adjunto', nombre: a.nombreArchivo, bytes: a.tamanoBytes });
      void cliente.invalidateQueries({ queryKey: ['ficha', 'adjuntos', pacienteId] });
    },
    onError: (e) => setErrorAdjunto(e instanceof ApiError ? e.message : 'No pudimos subir el archivo.'),
  });

  const quitar = useMutation({
    mutationFn: () => datos(api.DELETE('/api/borradores/{id}', { params: { path: { id: idBorrador.current! } } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['borradores'] });
      onListo();
    },
  });

  type BloqueNuevo = Bloque extends infer B ? (B extends Bloque ? Omit<B, 'id'> : never) : never;
  const agregar = (b: BloqueNuevo) => setBloques((l) => [...l, { ...b, id: siguienteBloque.current++ } as Bloque]);
  const editarBloque = (id: number, cambios: Partial<Bloque>) => setBloques((l) => l.map((b) => (b.id === id ? ({ ...b, ...cambios } as Bloque) : b)));
  const insertar = (tipo: Bloque['tipo']) => {
    setMenu(false);
    if (tipo === 'escala') agregar({ tipo, nombre: 'Ánimo' });
    if (tipo === 'tarea') agregar({ tipo, texto: '' });
    if (tipo === 'recordatorio') agregar({ tipo });
    if (tipo === 'adjunto') entradaArchivo.current?.click();
  };
  const elegirArchivo = (e: ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (archivo) subir.mutate(archivo);
  };
  const dar = (formato: Formato) => {
    const area = areaNotas.current;
    if (!area) return;
    const r = aplicarFormato(cuerpo, area.selectionStart, area.selectionEnd, formato);
    setCuerpo(r.texto);
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(r.inicio, r.fin);
    });
  };
  // "/" al comienzo de una linea abre el menu de insertar.
  const atajo = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const { selectionStart: i, value } = e.currentTarget;
    if (e.key === '/' && (i === 0 || value[i - 1] === '\n')) {
      e.preventDefault();
      setMenu(true);
    }
  };
  useEffect(() => {
    if (menu) primeraOpcion.current?.focus();
  }, [menu]);

  const guardarBorrador = async () => {
    const cuerpoGuardado = cuerpoBorrador(notas, citaId, plantillaId, valores, estructurados.nivelRiesgo);
    await persistir(cuerpoGuardado);
    if (ultimoGuardado.current !== JSON.stringify(cuerpoGuardado)) return;
    setAvisoBorrador(true);
    onBorradorGuardado();
  };

  const abrirConfirmacion = () => {
    const f = faltantes(campos, valores);
    if (!cuerpo.trim()) f.notas = 'Escribe las notas de la sesión.';
    setErrores(f);
    if (Object.keys(f).length === 0) setConfirmar(true);
  };

  const listoParaConfirmar = !!estructurados.tipoSesionId && !!estructurados.nivelRiesgo;

  return (
    <>
      <section aria-labelledby="titulo-editor" className="flex min-w-0 flex-col">
        <h2 id="titulo-editor" className="m-0 mb-2.5 text-[20px] font-black">
          {corrige ? 'Corregir evolución' : 'Nueva evolución'}
        </h2>
        <div
          role="toolbar"
          aria-label="Formato e inserción"
          className="relative flex flex-wrap items-center gap-1 rounded-t-[14px] bg-neutral-900 px-2.5 py-2 text-neutral-100"
          onKeyDown={(e) => e.key === 'Escape' && setMenu(false)}
        >
          {HERRAMIENTAS.map((h) => (
            <button
              key={h.formato}
              type="button"
              aria-label={h.etiqueta}
              title={h.etiqueta}
              onClick={() => dar(h.formato)}
              className={`grid size-10 cursor-pointer place-items-center rounded-sm text-[16px] hover:bg-neutral-800 ${h.clase ?? ''}`}
            >
              {h.icono ? <Icon name={h.icono} size={20} /> : h.marca}
            </button>
          ))}
          <span aria-hidden="true" className="mx-1 h-[22px] w-px bg-neutral-700" />
          <button
            type="button"
            aria-expanded={menu}
            aria-haspopup="menu"
            onClick={() => setMenu((m) => !m)}
            className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-sm bg-neutral-100 px-3.5 font-bold text-text hover:bg-neutral-200"
          >
            <Icon name="add" size={18} />
            Insertar
          </button>
          {!corrige && (
            <span className="ml-auto pr-1.5">
              <IndicadorGuardado estado={guardado} />
            </span>
          )}
          {menu && (
            <div
              role="menu"
              aria-label="Insertar bloque"
              onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setMenu(false)}
              className="absolute top-14 left-2 z-20 flex lg:left-[290px] w-[min(340px,calc(100%-16px))] flex-col gap-0.5 rounded-[14px] border border-divider bg-neutral-100 p-2 text-text shadow-lg"
            >
              <p className="m-0 px-2.5 pt-2 pb-1 text-[11px] font-bold tracking-[0.1em] text-neutral-700 uppercase">Insertar en la evolución</p>
              {OPCIONES.map((o, i) => (
                <button
                  key={o.tipo}
                  ref={i === 0 ? primeraOpcion : undefined}
                  type="button"
                  role="menuitem"
                  onClick={() => insertar(o.tipo)}
                  className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 text-left hover:bg-neutral-200"
                >
                  <span className="grid size-[34px] flex-none place-items-center rounded-[9px] bg-surface text-[12px] font-extrabold text-accent-700">
                    {o.sigla}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-bold">{o.nombre}</span>
                    <span className="block text-[12px] font-semibold text-neutral-700">{o.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={entradaArchivo}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          onChange={elegirArchivo}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        <div className="flex flex-col gap-[18px] rounded-b-[14px] border border-t-0 border-divider bg-neutral-100 px-[clamp(16px,4vw,56px)] pt-[clamp(20px,3vw,36px)] pb-7 shadow-md">
          {corrige && (
            <p className="m-0 flex items-start gap-2 text-[13px] font-bold text-accent-800">
              <Icon name="history" size={18} className="flex-none" />
              Corriges el registro del {formatoFechaLarga(corrige.createdAt)}: el original se conserva y queda enlazado. La corrección no se guarda como
              borrador; si la cierras antes de registrarla, se pierde.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!corrige && (
              <Select aria-label="Sesión que cierra" value={citaId} onChange={(e) => setCitaId(e.target.value)} className={CHIP}>
                <option value="">Sin sesión asociada</option>
                {sesiones.map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatoFechaLarga(c.inicio)}, {formatoHora(c.inicio)} · {c.modalidad === 'ONLINE' ? 'Online' : 'Presencial'}
                  </option>
                ))}
              </Select>
            )}
            {corrige ? (
              plantilla && (
                <p className="m-0 text-[12.5px] font-extrabold text-neutral-700">
                  Plantilla: {plantilla.nombre}, versión {plantilla.version} (la del registro que corriges)
                </p>
              )
            ) : (
              <Select
                aria-label="Plantilla de evolución"
                value={plantillaId}
                onChange={(e) => {
                  setPlantillaId(e.target.value);
                  setValores({});
                  setErrores({});
                }}
                className={CHIP}
              >
                <option value="">Sin plantilla (solo notas)</option>
                {plantillas.lista.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    Plantilla: {pl.nombre} · versión {pl.version}
                  </option>
                ))}
              </Select>
            )}
            <Select
              aria-label="Nivel de riesgo"
              value={estructurados.nivelRiesgo}
              onChange={(e) => setEstructurados({ ...estructurados, nivelRiesgo: e.target.value as NivelRiesgo | '' })}
              className={`${CHIP} ${estructurados.nivelRiesgo === 'MEDIO' || estructurados.nivelRiesgo === 'ALTO' ? '!border-accent-500 !bg-accent-200' : '!border-accent-2-500 !bg-accent-2-200'}`}
            >
              <option value="">Riesgo: sin indicar</option>
              {(Object.keys(NIVEL_RIESGO) as NivelRiesgo[]).map((n) => (
                <option key={n} value={n}>
                  {NIVEL_RIESGO[n].texto}
                </option>
              ))}
            </Select>
          </div>

          <label htmlFor="titulo-evolucion" className="sr-only">
            Título de la evolución
          </label>
          <input
            id="titulo-evolucion"
            type="text"
            value={titulo}
            maxLength={120}
            placeholder="Título de la evolución"
            onChange={(e) => setTitulo(e.target.value)}
            className="w-full border-0 bg-transparent p-0 text-[clamp(22px,2.4vw,30px)] leading-[1.2] font-black outline-offset-[6px] placeholder:text-neutral-600"
          />

          <label htmlFor="notas-evolucion" className="sr-only">
            Notas de la sesión
          </label>
          <textarea
            ref={areaNotas}
            id="notas-evolucion"
            rows={9}
            maxLength={MAX_NOTAS}
            value={cuerpo}
            placeholder="Escribe aquí las notas de la sesión. Con / al comienzo de una línea abres el menú de insertar."
            aria-invalid={!!errores.notas}
            onChange={(e) => setCuerpo(e.target.value)}
            onKeyDown={atajo}
            className="w-full resize-y border-0 bg-transparent p-0 text-[17px] leading-[1.75] font-medium outline-offset-[6px] placeholder:text-neutral-600"
          />
          {errores.notas && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {errores.notas}
            </p>
          )}

          {campos.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-xl border border-divider bg-bg px-4 py-3.5">
              <p className="m-0 text-[11px] font-bold tracking-[0.1em] text-accent-700 uppercase">Campos de plantilla</p>
              <FormularioDinamico campos={campos} valores={valores} onChange={setValores} errores={errores} />
            </div>
          )}

          {bloques.map((b) => (
            <div key={b.id} className="flex flex-col gap-2.5 rounded-xl border border-divider bg-bg px-4 py-3.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold tracking-[0.1em] text-accent-700">{ETIQUETA[b.tipo]}</span>
                <button
                  type="button"
                  aria-label="Quitar bloque"
                  onClick={() => setBloques((l) => l.filter((x) => x.id !== b.id))}
                  className="ml-auto grid size-8 cursor-pointer place-items-center rounded-sm text-neutral-700 hover:bg-neutral-200"
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
              {b.tipo === 'escala' && (
                <>
                  <Input
                    aria-label="Nombre de la escala"
                    value={b.nombre}
                    maxLength={40}
                    onChange={(e) => editarBloque(b.id, { nombre: e.target.value })}
                    className="!max-w-[280px] !py-1.5"
                  />
                  <EscalaDiez etiqueta={b.nombre || 'Escala'} valor={b.valor} onChange={(valor) => editarBloque(b.id, { valor })} />
                </>
              )}
              {b.tipo === 'tarea' && (
                <Input
                  aria-label="Tarea acordada"
                  value={b.texto}
                  maxLength={200}
                  placeholder="Qué acordaron para la próxima sesión"
                  onChange={(e) => editarBloque(b.id, { texto: e.target.value })}
                />
              )}
              {b.tipo === 'recordatorio' && <BloqueRecordatorio />}
              {b.tipo === 'adjunto' && (
                <p className="m-0 flex items-center gap-2.5 rounded-[10px] border border-dashed border-neutral-500 bg-neutral-100 px-3 py-2.5 text-[14px] font-semibold">
                  <Icon name="attach_file" size={18} className="flex-none text-accent-700" />
                  <span className="min-w-0 break-words">
                    {b.nombre} · {Math.ceil(b.bytes / 1024)} KB · cifrado, en Documentos y adjuntos
                  </span>
                </p>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setMenu(true)}
            className="min-h-10 cursor-pointer self-start rounded-[10px] border border-dashed border-neutral-500 px-3 text-[13px] font-semibold text-neutral-800 hover:border-accent-500"
          >
            + Agregar bloque (o escribe / en el texto)
          </button>

          {(errorGuardado || errorAdjunto) && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {errorGuardado ?? errorAdjunto}
            </p>
          )}
          {avisoBorrador && (
            <p
              role="status"
              className="m-0 flex items-start gap-2.5 rounded-xl border border-accent-400 bg-accent-100 px-3.5 py-3 text-[14px] font-semibold text-accent-800"
            >
              <Icon name="draft" size={18} className="flex-none" />
              <span>
                <strong>Borrador guardado.</strong> Tu progreso queda en la pila Borradores; puedes retomarlo y confirmarlo cuando quieras. No forma parte del
                expediente hasta confirmarlo.
              </span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-divider pt-4">
            <p className="m-0 w-full text-[12px] font-semibold text-neutral-800">
              {avisoEnPlantilla ? 'Las notas también son texto libre: sin datos identificatorios.' : ADVERTENCIA_TEXTO_LIBRE}
            </p>
            {!corrige && idBorrador.current && (
              <Button variant="ghost" icon="delete" onClick={() => setDescartar(true)}>
                Descartar borrador
              </Button>
            )}
            <Button variant="secondary" onClick={onListo}>
              {corrige ? 'Cancelar' : 'Cerrar'}
            </Button>
            {!corrige && (
              <Button variant="secondary" icon="draft" disabled={!notas.trim()} onClick={() => void guardarBorrador()}>
                Guardar como borrador
              </Button>
            )}
            <Button variant="team" icon="task_alt" onClick={abrirConfirmacion}>
              {corrige ? 'Registrar corrección' : 'Confirmar en el expediente'}
            </Button>
          </div>
        </div>
      </section>
      <Modal
        abierto={confirmar}
        onCerrar={() => setConfirmar(false)}
        ancho="lg"
        titulo={corrige ? 'Registrar corrección' : 'Confirmar en el expediente'}
        descripcion={
          corrige
            ? 'Queda como un registro nuevo enlazado al original. Ninguno de los dos se puede editar ni borrar después.'
            : 'Al confirmar, la evolución pasa al expediente y ya no se edita ni se borra: un error se corrige con un registro nuevo. El borrador se elimina.'
        }
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmar(false)}>
              Volver a editar
            </Button>
            <Button variant="team" icon="task_alt" loading={registrar.isPending} disabled={!listoParaConfirmar} onClick={() => registrar.mutate()}>
              {corrige ? 'Registrar corrección' : 'Confirmar'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Tipo de sesión" required hint="Solo tipos aprobados por administración. Puedes proponer uno nuevo en Fichas › Catálogos clínicos.">
            {(p) => (
              <Select {...p} value={estructurados.tipoSesionId} onChange={(e) => setEstructurados({ ...estructurados, tipoSesionId: e.target.value })}>
                <option value="">Elige el tipo de sesión</option>
                {(tipos.data ?? [])
                  .filter((t) => t.activo || t.id === estructurados.tipoSesionId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <ChoiceGroup
            legend="Nivel de riesgo"
            type="radio"
            required
            options={(Object.keys(NIVEL_RIESGO) as NivelRiesgo[]).map((n) => ({ value: n, label: NIVEL_RIESGO[n].texto }))}
            value={estructurados.nivelRiesgo ? [estructurados.nivelRiesgo] : []}
            onChange={(v) => setEstructurados({ ...estructurados, nivelRiesgo: (v[0] as NivelRiesgo) ?? '' })}
          />
          <Field label="Estado de avance">
            {(p) => (
              <Select {...p} value={estructurados.estadoAvanceId} onChange={(e) => setEstructurados({ ...estructurados, estadoAvanceId: e.target.value })}>
                <option value="">Sin indicar</option>
                {(estados.data ?? [])
                  .filter((x) => x.activo)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          {(intervenciones.data ?? []).some((i) => i.activo) && (
            <ChoiceGroup
              legend="Intervenciones realizadas"
              type="checkbox"
              options={(intervenciones.data ?? []).filter((i) => i.activo).map((i) => ({ value: i.id, label: i.nombre }))}
              value={estructurados.intervencionIds}
              onChange={(v) => setEstructurados({ ...estructurados, intervencionIds: v.slice(0, 20) })}
            />
          )}
          {registrar.error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {registrar.error instanceof ApiError ? registrar.error.message : 'No pudimos registrar la evolución.'}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        abierto={descartar}
        onCerrar={() => setDescartar(false)}
        titulo="¿Descartar el borrador?"
        descripcion="Se borra lo que escribiste. No queda nada en el expediente."
        acciones={
          <>
            <Button variant="ghost" onClick={() => setDescartar(false)}>
              Volver
            </Button>
            <Button variant="team" icon="delete" loading={quitar.isPending} onClick={() => quitar.mutate()}>
              Descartar
            </Button>
          </>
        }
      >
        {quitar.error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {quitar.error instanceof ApiError ? quitar.error.message : 'No pudimos descartar el borrador.'}
          </p>
        )}
      </Modal>
    </>
  );
}

/** Se guarda al momento en Mis recordatorios: nunca entra al expediente. */
function BloqueRecordatorio() {
  const cliente = useQueryClient();
  const [texto, setTexto] = useState('');
  const crear = useMutation({
    mutationFn: () => datos(api.POST('/api/mis-recordatorios', { body: { texto: texto.trim() } })),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['mis-recordatorios'] }),
  });
  if (crear.isSuccess) {
    return <p className="m-0 text-[14px] font-semibold">{texto.trim()} · Guardado en Mis recordatorios.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Recordatorio"
          value={texto}
          maxLength={200}
          placeholder="Por ejemplo: preparar material para la próxima sesión"
          onChange={(e) => setTexto(e.target.value)}
          className="min-w-[220px] flex-1 !py-2"
        />
        <Button variant="secondary" disabled={!texto.trim()} loading={crear.isPending} onClick={() => crear.mutate()} className="!py-2.5">
          Guardar
        </Button>
      </div>
      <p className="m-0 text-[12px] font-semibold text-neutral-700">Solo para ti. Se guarda en Mis recordatorios, fuera del expediente.</p>
      {crear.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {crear.error instanceof ApiError ? crear.error.message : 'No pudimos guardar el recordatorio.'}
        </p>
      )}
    </div>
  );
}

function cuerpoBorrador(contenido: string, citaId: string, plantillaId: string, valores: ValoresPlantilla, nivelRiesgo: NivelRiesgo | '') {
  return {
    contenido,
    citaId: citaId || undefined,
    plantillaId: plantillaId || undefined,
    valores: plantillaId ? valores : undefined,
    nivelRiesgo: nivelRiesgo || undefined,
  };
}

const TEXTO_GUARDADO: Record<EstadoGuardado, string> = {
  vacio: 'Escribe las notas para guardar el borrador',
  pendiente: 'Cambios sin guardar',
  guardando: 'Guardando…',
  guardado: 'Borrador guardado',
  error: 'No se pudo guardar',
};

function IndicadorGuardado({ estado }: { estado: EstadoGuardado }) {
  return (
    <span role="status" aria-live="polite" className={`text-[12px] font-semibold ${estado === 'error' ? 'text-accent-300' : 'text-neutral-300'}`}>
      {TEXTO_GUARDADO[estado]}
    </span>
  );
}
