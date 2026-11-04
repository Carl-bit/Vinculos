'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useConfiguracionCentro, useContenidoPublico, type ConfiguracionCentro, type ContenidoPublico } from '@/lib/centro';
import { rutValido } from '@/lib/formato';
import { subirArchivo } from '@/lib/subidas';
import { reglaCorreo, reglaTelefono, useValidacionCampos, type Regla } from '@/lib/validacion';
import { CampoRut, rutMientrasEscribe, rutNormalizado } from '@/components/shared/CampoRut';

import { BarraGuardado } from './BarraGuardado';

interface Servicio {
  icono?: string;
  titulo: string;
  texto: string;
}

type Formulario = Record<
  | 'nombreCentro'
  | 'rutCentro'
  | 'heroTitulo'
  | 'heroTexto'
  | 'contactoCorreo'
  | 'contactoTelefono'
  | 'direccion'
  | 'whatsapp'
  | 'instagram'
  | 'mision'
  | 'vision'
  | 'colorMarca',
  string
>;

const desde = (c: ConfiguracionCentro, p: ContenidoPublico): Formulario => ({
  nombreCentro: c.nombreCentro,
  rutCentro: c.rutCentro ? rutMientrasEscribe(c.rutCentro) : '',
  heroTitulo: p.heroTitulo ?? '',
  heroTexto: p.heroTexto ?? '',
  contactoCorreo: p.contactoCorreo ?? '',
  contactoTelefono: p.contactoTelefono ?? '',
  direccion: p.direccion ?? '',
  whatsapp: p.whatsapp ?? '',
  instagram: p.instagram ?? '',
  mision: p.mision ?? '',
  vision: p.vision ?? '',
  colorMarca: p.colorMarca ?? '',
});

/** Colores sugeridos del diseño; el hexadecimal admite cualquier otro. */
const COLORES: [string, string][] = [
  ['Arcilla', '#8a4a1f'],
  ['Bosque', '#4f6b2f'],
  ['Océano', '#2f5a7a'],
  ['Ciruela', '#6b3a5c'],
  ['Arena', '#c9a227'],
];
const COLOR_BASE = '#8a4a1f';

/** Contraste WCAG del texto blanco sobre un color #RRGGBB. */
function contrasteConBlanco(hex: string): number {
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
  return 1.05 / (l + 0.05);
}

/**
 * Datos y pagina publica (diseño "Opcion A submenu agrupado"): identidad y
 * contacto (nombre y RUT: remitente de correos y emisor de comprobantes del
 * modelo CENTRO), logo, textos de la portada, mision, vision y servicios; al
 * costado, el color de marca con vista previa y contraste. Un campo vacio se
 * borra (null). Solo ADMIN.
 */
export function DatosCentro() {
  const configuracion = useConfiguracionCentro();
  const contenido = useContenidoPublico();
  const [descartes, setDescartes] = useState(0);
  return (
    <EstadoConsulta consulta={configuracion}>
      {(c) => (
        <EstadoConsulta consulta={contenido}>
          {(p) => <Formulario key={`${p.updatedAt}-${c.updatedAt}-${descartes}`} c={c} p={p} onDescartar={() => setDescartes((n) => n + 1)} />}
        </EstadoConsulta>
      )}
    </EstadoConsulta>
  );
}

const COLOR: Regla = (v) => (!v || /^#[0-9a-fA-F]{6}$/.test(v) ? undefined : 'El color de marca debe tener el formato #RRGGBB.');

const SECCION = 'rounded-lg border border-divider bg-neutral-100 p-5 shadow-sm';

function Formulario({ c, p, onDescartar }: { c: ConfiguracionCentro; p: ContenidoPublico; onDescartar: () => void }) {
  const cliente = useQueryClient();
  const [f, setF] = useState<Formulario>(desde(c, p));
  const [servicios, setServicios] = useState<Servicio[]>((p.servicios as Servicio[] | null) ?? []);
  const [editando, setEditando] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [guardado, setGuardado] = useState(false);
  const [cambiado, setCambiado] = useState(false);
  const [logo, setLogo] = useState(p.logoImagenId);
  const archivo = useRef<HTMLInputElement>(null);
  const formato = useValidacionCampos<'contactoCorreo' | 'contactoTelefono' | 'whatsapp' | 'colorMarca'>({
    contactoCorreo: reglaCorreo(),
    contactoTelefono: reglaTelefono,
    whatsapp: reglaTelefono,
    colorMarca: COLOR,
  });
  const tocar = () => {
    setGuardado(false);
    setCambiado(true);
  };
  const poner = (k: keyof Formulario, v: string) => {
    tocar();
    if (k === 'contactoCorreo' || k === 'contactoTelefono' || k === 'whatsapp' || k === 'colorMarca') formato.limpiar(k);
    setF((x) => ({ ...x, [k]: v }));
  };
  const cambiar = (k: keyof Formulario) => (e: { target: { value: string } }) => poner(k, e.target.value);
  const salir = (k: 'contactoCorreo' | 'contactoTelefono' | 'whatsapp') => () => formato.alSalir(k, f[k]);
  const cambiarServicios = (cambio: (l: Servicio[]) => Servicio[]) => {
    tocar();
    setServicios(cambio);
  };
  const o = (v: string) => (v.trim() ? v.trim() : null);

  const guardar = useMutation({
    mutationFn: async () => {
      await datos(api.PATCH('/api/configuracion', { body: { nombreCentro: f.nombreCentro.trim(), rutCentro: rutNormalizado(f.rutCentro) || undefined } }));
      await datos(
        api.PATCH('/api/configuracion/contenido-publico', {
          body: {
            heroTitulo: o(f.heroTitulo),
            heroTexto: o(f.heroTexto),
            contactoCorreo: o(f.contactoCorreo),
            contactoTelefono: o(f.contactoTelefono),
            direccion: o(f.direccion),
            whatsapp: o(f.whatsapp),
            instagram: o(f.instagram),
            mision: o(f.mision),
            vision: o(f.vision),
            colorMarca: o(f.colorMarca),
            servicios: servicios.filter((s) => s.titulo.trim() && s.texto.trim()),
          },
        }),
      );
    },
    onSuccess: () => {
      setError(undefined);
      setGuardado(true);
      void cliente.invalidateQueries({ queryKey: ['configuracion'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar los datos del centro.'),
  });
  const subir = useMutation({
    mutationFn: (a: File) => subirArchivo<{ logoImagenId: string; url: string }>('/api/configuracion/logo', 'imagen', a),
    onSuccess: (r) => {
      setLogo(r.logoImagenId);
      setError(undefined);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos subir el logo.'),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!f.nombreCentro.trim()) return setError('El nombre del centro es obligatorio.');
    if (f.rutCentro.trim() && !rutValido(f.rutCentro)) return setError('El RUT del centro no es válido (revisa el dígito verificador).');
    if (!formato.validarTodo(f)) return setError('Revisa los campos marcados.');
    guardar.mutate();
  };

  const color = /^#[0-9a-fA-F]{6}$/.test(f.colorMarca) ? f.colorMarca : COLOR_BASE;
  const contrasteBajo = contrasteConBlanco(color) < 4.5;
  const avisoVacio = (texto: string) => <span className="font-bold text-pendiente-900">{texto}</span>;

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-[18px]">
      <div className="flex flex-col items-start gap-[18px] xl:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-[18px]">
          <section aria-labelledby="datos-identidad" className={SECCION}>
            <h3 id="datos-identidad" className="m-0 mb-3.5 text-[17px] font-black">
              Identidad y contacto
            </h3>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Nombre del centro" required>
                {(x) => <Input {...x} value={f.nombreCentro} maxLength={120} onChange={cambiar('nombreCentro')} />}
              </Field>
              <CampoRut label="RUT del centro" placeholder="76.123.456-7" value={f.rutCentro} onChange={(v) => poner('rutCentro', v)} />
              <Field label="Correo de contacto" hint="También recibe las respuestas a los correos del sistema." error={formato.errores.contactoCorreo}>
                {(x) => <Input {...x} type="email" value={f.contactoCorreo} onChange={cambiar('contactoCorreo')} onBlur={salir('contactoCorreo')} />}
              </Field>
              <Field label="Teléfono" error={formato.errores.contactoTelefono}>
                {(x) => (
                  <Input
                    {...x}
                    type="tel"
                    placeholder="+56XXXXXXXXX"
                    value={f.contactoTelefono}
                    onChange={cambiar('contactoTelefono')}
                    onBlur={salir('contactoTelefono')}
                  />
                )}
              </Field>
              <Field label="Dirección">{(x) => <Input {...x} value={f.direccion} maxLength={300} onChange={cambiar('direccion')} />}</Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="WhatsApp" error={formato.errores.whatsapp}>
                  {(x) => <Input {...x} type="tel" placeholder="+569XXXXXXXX" value={f.whatsapp} onChange={cambiar('whatsapp')} onBlur={salir('whatsapp')} />}
                </Field>
                <Field label="Instagram">
                  {(x) => <Input {...x} value={f.instagram} maxLength={31} onChange={cambiar('instagram')} placeholder="@centro" />}
                </Field>
              </div>
            </div>
            <div className="mt-3.5 flex flex-wrap items-center gap-3.5 rounded-[14px] border-[1.5px] border-dashed border-neutral-400 bg-bg px-3.5 py-3">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- imagen publica servida por la API, tamaño variable
                <img src={`/api/publico/imagenes/${logo}`} alt="Logo actual del centro" className="h-12 max-w-[160px] object-contain" />
              ) : (
                <span className="grid size-12 place-items-center rounded-[12px] bg-neutral-200 text-neutral-700" aria-hidden>
                  <Icon name="image" />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <strong className="text-[14px]">Logo del centro</strong>
                <span className="text-[12px] font-semibold text-neutral-700">JPEG, PNG o WebP. Se le quitan los metadatos antes de publicarlo.</span>
              </span>
              <input
                ref={archivo}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Elegir logo"
                onChange={(e) => {
                  const a = e.target.files?.[0];
                  if (a) subir.mutate(a);
                  e.target.value = '';
                }}
              />
              <Button variant="secondary" icon="upload" loading={subir.isPending} onClick={() => archivo.current?.click()} className="!py-2">
                {logo ? 'Reemplazar logo' : 'Subir logo'}
              </Button>
            </div>
          </section>

          <section aria-labelledby="datos-textos" className={SECCION}>
            <div className="mb-3.5 flex flex-wrap items-baseline gap-2.5">
              <h3 id="datos-textos" className="m-0 text-[17px] font-black">
                Textos de la página pública
              </h3>
              <a href="/" target="_blank" rel="noreferrer" className="text-[13px] font-extrabold text-accent-700">
                Abrir la página pública
              </a>
            </div>
            <div className="flex flex-col gap-3.5">
              <Field label="Título de la portada">{(x) => <Input {...x} value={f.heroTitulo} maxLength={160} onChange={cambiar('heroTitulo')} />}</Field>
              <Field label="Texto de la portada">
                {(x) => <Textarea {...x} rows={2} maxLength={1000} value={f.heroTexto} onChange={cambiar('heroTexto')} />}
              </Field>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Misión" hint={!f.mision.trim() ? avisoVacio('Vacía: «Quiénes somos» no se muestra en la página.') : undefined}>
                  {(x) => (
                    <Textarea
                      {...x}
                      rows={3}
                      maxLength={2000}
                      placeholder="Para qué existe el centro, en dos o tres líneas."
                      value={f.mision}
                      onChange={cambiar('mision')}
                      className={!f.mision.trim() ? '!border-pendiente-700' : ''}
                    />
                  )}
                </Field>
                <Field label="Visión" hint={!f.vision.trim() ? avisoVacio('Vacía.') : undefined}>
                  {(x) => (
                    <Textarea
                      {...x}
                      rows={3}
                      maxLength={2000}
                      placeholder="Hacia dónde quiere crecer el centro."
                      value={f.vision}
                      onChange={cambiar('vision')}
                      className={!f.vision.trim() ? '!border-pendiente-700' : ''}
                    />
                  )}
                </Field>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-extrabold">Servicios</span>
                  <span className="text-[12px] font-semibold text-neutral-700">{servicios.length} de 12</span>
                  {servicios.length < 12 && (
                    <Button
                      variant="secondary"
                      icon="add"
                      onClick={() => {
                        cambiarServicios((s) => [...s, { titulo: '', texto: '' }]);
                        setEditando(servicios.length);
                      }}
                      className="ml-auto !py-1.5 !text-[13px]"
                    >
                      Agregar servicio
                    </Button>
                  )}
                </div>
                {servicios.length === 0 && <p className="m-0 text-[13px] font-semibold text-neutral-800">Sin servicios publicados.</p>}
                {servicios.map((s, i) =>
                  editando === i ? (
                    <div key={i} className="grid gap-3 rounded-[12px] border border-accent-500 bg-bg p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                      <Field label={`Servicio ${i + 1}`}>
                        {(x) => (
                          <Input
                            {...x}
                            value={s.titulo}
                            maxLength={120}
                            onChange={(e) => cambiarServicios((l) => l.map((y, j) => (j === i ? { ...y, titulo: e.target.value } : y)))}
                          />
                        )}
                      </Field>
                      <Field label="Descripción">
                        {(x) => (
                          <Input
                            {...x}
                            value={s.texto}
                            maxLength={600}
                            onChange={(e) => cambiarServicios((l) => l.map((y, j) => (j === i ? { ...y, texto: e.target.value } : y)))}
                          />
                        )}
                      </Field>
                      <Button variant="secondary" onClick={() => setEditando(null)} className="!py-2.5">
                        Listo
                      </Button>
                    </div>
                  ) : (
                    <div key={i} className="flex items-center gap-3 rounded-[12px] border border-divider bg-bg px-3 py-2.5">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <strong className="text-[14px]">{s.titulo || 'Servicio sin nombre'}</strong>
                        <span className="text-[12px] font-semibold text-neutral-700">{s.texto || 'Sin descripción: no se publica hasta completarla.'}</span>
                      </span>
                      <button
                        type="button"
                        aria-label={`Editar servicio ${i + 1}`}
                        onClick={() => setEditando(i)}
                        className="min-h-9 cursor-pointer rounded-full px-3 text-[13px] font-extrabold text-accent-700 hover:bg-accent-100"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        aria-label={`Quitar servicio ${i + 1}`}
                        onClick={() => {
                          cambiarServicios((l) => l.filter((_, j) => j !== i));
                          setEditando(null);
                        }}
                        className="min-h-9 cursor-pointer rounded-full px-3 text-[13px] font-bold text-neutral-700 hover:bg-neutral-200"
                      >
                        Quitar
                      </button>
                    </div>
                  ),
                )}
              </div>
            </div>
          </section>
        </div>

        <aside aria-label="Vista previa" className="flex w-full flex-col gap-3.5 xl:w-[300px] xl:flex-none">
          <section aria-labelledby="datos-color" className={`${SECCION} flex flex-col gap-3`}>
            <h3 id="datos-color" className="m-0 text-[17px] font-black">
              Color de marca
            </h3>
            <span className="text-[12px] font-semibold text-neutral-700">Solo cambia la página pública; el panel mantiene la paleta del sistema.</span>
            <div role="group" aria-label="Colores sugeridos" className="flex flex-wrap gap-2">
              {COLORES.map(([nombre, hex]) => {
                const elegido = color.toLowerCase() === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-label={nombre}
                    aria-pressed={elegido}
                    onClick={() => poner('colorMarca', hex)}
                    className={`size-11 cursor-pointer rounded-full border-[3px] ${elegido ? 'border-text' : 'border-neutral-100'}`}
                    style={{ background: hex }}
                  />
                );
              })}
            </div>
            <Field label="Hexadecimal" error={formato.errores.colorMarca}>
              {(x) => <Input {...x} value={f.colorMarca} maxLength={7} placeholder="#RRGGBB" onChange={cambiar('colorMarca')} className="!py-2.5" />}
            </Field>
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-divider bg-bg p-4">
              <span className="text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Así se ve en la portada</span>
              <span className="text-[18px] leading-tight font-black">{f.heroTitulo.trim() || f.nombreCentro}</span>
              <span
                className="inline-flex min-h-10 items-center self-start rounded-full px-[18px] text-[14px] font-extrabold text-white"
                style={{ background: color }}
              >
                Reservar una hora
              </span>
              <span className={`text-[12px] font-bold ${contrasteBajo ? 'text-accent-800' : 'text-accent-2-800'}`}>
                {contrasteBajo ? 'El texto blanco no se lee bien sobre este color (contraste bajo AA).' : 'Contraste AA correcto para el texto blanco.'}
              </span>
            </div>
          </section>
        </aside>
      </div>

      <BarraGuardado
        seccion="Datos y página pública"
        error={error}
        guardado={guardado}
        cambiado={cambiado}
        guardando={guardar.isPending}
        onDescartar={onDescartar}
      />
    </form>
  );
}
