'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useConfiguracionCentro, useContenidoPublico, type ConfiguracionCentro, type ContenidoPublico } from '@/lib/centro';
import { rutValido } from '@/lib/formato';
import { subirArchivo } from '@/lib/subidas';
import { CampoRut, rutNormalizado } from '@/components/shared/CampoRut';

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
  rutCentro: c.rutCentro ?? '',
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

/**
 * Datos del centro (diseño "Configuracion", pestaña Identidad): nombre y RUT
 * (remitente de correos y emisor de boletas del modelo CENTRO), contacto,
 * mision y vision, portada, servicios, logo y color de marca de la pagina
 * publica. Un campo vacio se borra (null). Solo ADMIN.
 */
export function DatosCentro() {
  const configuracion = useConfiguracionCentro();
  const contenido = useContenidoPublico();
  return (
    <EstadoConsulta consulta={configuracion}>
      {(c) => <EstadoConsulta consulta={contenido}>{(p) => <Formulario key={p.updatedAt + c.updatedAt} c={c} p={p} />}</EstadoConsulta>}
    </EstadoConsulta>
  );
}

function Formulario({ c, p }: { c: ConfiguracionCentro; p: ContenidoPublico }) {
  const cliente = useQueryClient();
  const [f, setF] = useState<Formulario>(desde(c, p));
  const [servicios, setServicios] = useState<Servicio[]>((p.servicios as Servicio[] | null) ?? []);
  const [error, setError] = useState<string>();
  const [guardado, setGuardado] = useState(false);
  const [logo, setLogo] = useState(p.logoImagenId);
  const archivo = useRef<HTMLInputElement>(null);
  const cambiar = (k: keyof Formulario) => (e: { target: { value: string } }) => {
    setGuardado(false);
    setF((x) => ({ ...x, [k]: e.target.value }));
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
    if (f.colorMarca && !/^#[0-9a-fA-F]{6}$/.test(f.colorMarca)) return setError('El color de marca debe tener el formato #RRGGBB.');
    guardar.mutate();
  };

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-6">
      <Panel titulo="Identidad del centro" bajada="El nombre y el RUT salen en los correos y en las boletas cuando cobra el centro.">
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Nombre del centro" required>
            {(x) => <Input {...x} value={f.nombreCentro} maxLength={120} onChange={cambiar('nombreCentro')} />}
          </Field>
          <CampoRut label="RUT del centro" placeholder="76.123.456-7" value={f.rutCentro} onChange={(v) => setF((a) => ({ ...a, rutCentro: v }))} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4 rounded-[18px] border border-divider bg-bg p-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen publica servida por la API, tamaño variable
            <img src={`/api/publico/imagenes/${logo}`} alt="Logo actual del centro" className="h-14 max-w-[180px] object-contain" />
          ) : (
            <span className="grid size-14 place-items-center rounded-full border border-divider text-neutral-700" aria-hidden>
              <Icon name="image" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[14px] font-extrabold">Logo del centro</p>
            <p className="m-0 text-[12.5px] font-semibold text-neutral-700">JPEG, PNG o WebP. Se le quitan los metadatos antes de publicarlo.</p>
          </div>
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
          <Button variant="secondary" icon="upload" loading={subir.isPending} onClick={() => archivo.current?.click()}>
            {logo ? 'Reemplazar' : 'Subir logo'}
          </Button>
        </div>
      </Panel>

      <Panel titulo="Contacto" bajada="Lo que se edita acá se refleja en la página pública.">
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Correo de contacto">{(x) => <Input {...x} type="email" value={f.contactoCorreo} onChange={cambiar('contactoCorreo')} />}</Field>
          <Field label="Teléfono" hint="+56XXXXXXXXX">
            {(x) => <Input {...x} type="tel" value={f.contactoTelefono} onChange={cambiar('contactoTelefono')} />}
          </Field>
          <Field label="Dirección">{(x) => <Input {...x} value={f.direccion} maxLength={300} onChange={cambiar('direccion')} />}</Field>
          <Field label="WhatsApp" hint="+56XXXXXXXXX">
            {(x) => <Input {...x} type="tel" value={f.whatsapp} onChange={cambiar('whatsapp')} />}
          </Field>
          <Field label="Instagram">{(x) => <Input {...x} value={f.instagram} maxLength={31} onChange={cambiar('instagram')} placeholder="@centro" />}</Field>
        </div>
      </Panel>

      <Panel titulo="Portada, misión y visión" bajada='Textos de la portada y de "Quiénes somos" en la página pública.'>
        <div className="mt-4 flex flex-col gap-4">
          <Field label="Título de la portada">{(x) => <Input {...x} value={f.heroTitulo} maxLength={160} onChange={cambiar('heroTitulo')} />}</Field>
          <Field label="Texto de la portada">{(x) => <Textarea {...x} rows={2} maxLength={1000} value={f.heroTexto} onChange={cambiar('heroTexto')} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Misión">{(x) => <Textarea {...x} rows={4} maxLength={2000} value={f.mision} onChange={cambiar('mision')} />}</Field>
            <Field label="Visión">{(x) => <Textarea {...x} rows={4} maxLength={2000} value={f.vision} onChange={cambiar('vision')} />}</Field>
          </div>
        </div>
      </Panel>

      <Panel
        titulo="Servicios"
        bajada="Hasta 12. Aparecen en la sección de servicios de la página pública."
        accion={
          servicios.length < 12 ? (
            <Button variant="secondary" icon="add" onClick={() => setServicios((s) => [...s, { titulo: '', texto: '' }])} className="!py-2.5">
              Agregar servicio
            </Button>
          ) : undefined
        }
      >
        <div className="mt-4 flex flex-col gap-3">
          {servicios.length === 0 && <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Sin servicios publicados.</p>}
          {servicios.map((s, i) => (
            <div key={i} className="grid gap-3 rounded-[18px] border border-divider bg-bg p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
              <Field label={`Servicio ${i + 1}`}>
                {(x) => (
                  <Input
                    {...x}
                    value={s.titulo}
                    maxLength={120}
                    onChange={(e) => setServicios((l) => l.map((y, j) => (j === i ? { ...y, titulo: e.target.value } : y)))}
                  />
                )}
              </Field>
              <Field label="Descripción">
                {(x) => (
                  <Input
                    {...x}
                    value={s.texto}
                    maxLength={600}
                    onChange={(e) => setServicios((l) => l.map((y, j) => (j === i ? { ...y, texto: e.target.value } : y)))}
                  />
                )}
              </Field>
              <button
                type="button"
                aria-label={`Quitar servicio ${i + 1}`}
                onClick={() => setServicios((l) => l.filter((_, j) => j !== i))}
                className="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-accent-200"
              >
                <Icon name="delete" />
              </button>
            </div>
          ))}
        </div>
      </Panel>

      <Panel titulo="Marca" bajada="Color de acento de la página pública del centro (el panel mantiene la paleta del sistema).">
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <input
            type="color"
            aria-label="Color de marca"
            value={f.colorMarca || '#8a4a1f'}
            onChange={cambiar('colorMarca')}
            className="size-12 cursor-pointer rounded-full border border-divider bg-bg p-1"
          />
          <Input
            aria-label="Color de marca en hexadecimal"
            value={f.colorMarca}
            maxLength={7}
            placeholder="#RRGGBB"
            onChange={cambiar('colorMarca')}
            className="!w-[140px]"
          />
          <span className="rounded-full px-5 py-2.5 text-[13.5px] font-extrabold text-neutral-100" style={{ background: f.colorMarca || '#8a4a1f' }}>
            Reservar una hora
          </span>
        </div>
        <p className="m-0 mt-3 text-[12.5px] font-semibold text-neutral-700">Revisa que el texto blanco se lea bien sobre el color elegido (contraste AA).</p>
      </Panel>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-full border border-divider bg-bg/95 px-4 py-2.5 shadow-md">
        {error && (
          <p role="alert" className="m-0 mr-auto text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        {guardado && !error && (
          <p role="status" className="m-0 mr-auto text-[13px] font-bold text-accent-2-800">
            Cambios guardados.
          </p>
        )}
        <Button type="submit" variant="team" icon="save" loading={guardar.isPending}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
