'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Interruptor } from '@/components/ui/Interruptor';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { NOMBRE_MODALIDAD, type PerfilProfesional } from '@/lib/equipo';
import { subirArchivo } from '@/lib/subidas';

const lista = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Perfil profesional (diseños "Perfil Profesional" y "Mi Perfil"): datos que
 * salen en el perfil publico. `propio`: el profesional lo crea o edita y es
 * el unico que puede publicarlo (consentimiento; la BD exige tarifa general).
 * `equipo`: ADMIN/GESTION corrigen un perfil existente, sin publicarlo.
 */
export function FormularioPerfil({
  modo,
  profesionalId,
  perfil,
  puedeFoto,
}: {
  modo: 'propio' | 'equipo';
  profesionalId: string;
  perfil: PerfilProfesional | null;
  puedeFoto: boolean;
}) {
  const cliente = useQueryClient();
  const [f, setF] = useState({
    especialidad: perfil?.especialidad ?? '',
    modalidad: perfil?.modalidad ?? ('PRESENCIAL' as PerfilProfesional['modalidad']),
    nombrePublico: perfil?.nombrePublico ?? '',
    bio: perfil?.bio ?? '',
    citaDestacada: perfil?.citaDestacada ?? '',
    enfoques: (perfil?.enfoques ?? []).join(', '),
    idiomas: (perfil?.idiomas ?? []).join(', '),
    convenios: (perfil?.convenios ?? []).join(', '),
  });
  const [opciones, setOpciones] = useState({
    perfilPublico: perfil?.perfilPublico ?? false,
    cobroDirecto: perfil?.cobroDirecto ?? false,
    boletaReembolsable: perfil?.boletaReembolsable ?? false,
  });
  const [foto, setFoto] = useState(perfil?.fotoUrl ?? null);
  const [estado, setEstado] = useState<{ error?: string; ok?: boolean }>({});
  const archivo = useRef<HTMLInputElement>(null);
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setEstado({});
    setF((x) => ({ ...x, [k]: e.target.value }));
  };

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        especialidad: f.especialidad.trim(),
        modalidad: f.modalidad,
        nombrePublico: f.nombrePublico.trim() || undefined,
        bio: f.bio.trim() || undefined,
        citaDestacada: f.citaDestacada.trim() || undefined,
        enfoques: lista(f.enfoques),
        idiomas: lista(f.idiomas),
        convenios: lista(f.convenios),
        cobroDirecto: opciones.cobroDirecto,
        boletaReembolsable: opciones.boletaReembolsable,
      };
      return modo === 'propio'
        ? datos(api.PUT('/api/profesionales/yo/perfil', { body: { ...cuerpo, perfilPublico: opciones.perfilPublico } }))
        : datos(api.PATCH('/api/profesionales/{id}/perfil', { params: { path: { id: profesionalId } }, body: cuerpo }));
    },
    onSuccess: () => {
      setEstado({ ok: true });
      void cliente.invalidateQueries({ queryKey: ['equipo', 'perfil', profesionalId] });
    },
    onError: (e) => setEstado({ error: e instanceof ApiError ? e.message : 'No pudimos guardar el perfil.' }),
  });
  const subir = useMutation({
    mutationFn: (a: File) =>
      subirArchivo<{ fotoUrl: string }>(modo === 'propio' ? '/api/profesionales/yo/foto' : `/api/profesionales/${profesionalId}/foto`, 'imagen', a),
    onSuccess: (r) => {
      setFoto(r.fotoUrl);
      setEstado({});
      void cliente.invalidateQueries({ queryKey: ['equipo', 'perfil', profesionalId] });
    },
    onError: (e) => setEstado({ error: e instanceof ApiError ? e.message : 'No pudimos subir la foto.' }),
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!f.especialidad.trim()) return setEstado({ error: 'La especialidad es obligatoria (por ejemplo, Psicología clínica).' });
    guardar.mutate();
  };

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      {perfil && puedeFoto && (
        <div className="flex flex-wrap items-center gap-4 rounded-[18px] border border-divider bg-bg p-4">
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagen publica servida por la API
            <img src={foto} alt="Foto de perfil actual" className="size-16 rounded-full object-cover" />
          ) : (
            <span className="grid size-16 place-items-center rounded-full border border-divider text-neutral-700" aria-hidden>
              <Icon name="photo_camera" />
            </span>
          )}
          <p className="m-0 min-w-0 flex-1 text-[12.5px] font-semibold text-neutral-700">JPEG, PNG o WebP. Se publica sin metadatos en el perfil público.</p>
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
          <Button variant="secondary" icon="upload" loading={subir.isPending} onClick={() => archivo.current?.click()}>
            {foto ? 'Cambiar foto' : 'Subir foto'}
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Especialidad" required hint="Como aparece bajo el nombre.">
          {(x) => <Input {...x} value={f.especialidad} maxLength={120} onChange={cambiar('especialidad')} />}
        </Field>
        <Field label="Modalidad">
          {(x) => (
            <Select {...x} value={f.modalidad} onChange={(e) => setF((y) => ({ ...y, modalidad: e.target.value as PerfilProfesional['modalidad'] }))}>
              {(Object.keys(NOMBRE_MODALIDAD) as PerfilProfesional['modalidad'][]).map((m) => (
                <option key={m} value={m}>
                  {NOMBRE_MODALIDAD[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Nombre público (opcional)" hint="Si se deja vacío, se usa el nombre de la cuenta.">
          {(x) => <Input {...x} value={f.nombrePublico} maxLength={120} onChange={cambiar('nombrePublico')} />}
        </Field>
        <Field label="Enfoques" hint="Separados por coma.">
          {(x) => <Input {...x} value={f.enfoques} onChange={cambiar('enfoques')} placeholder="Cognitivo conductual, sistémico" />}
        </Field>
        <Field label="Idiomas" hint="Separados por coma.">
          {(x) => <Input {...x} value={f.idiomas} onChange={cambiar('idiomas')} placeholder="Español, inglés" />}
        </Field>
        <Field label="Convenios" hint="Separados por coma.">
          {(x) => <Input {...x} value={f.convenios} onChange={cambiar('convenios')} placeholder="Fonasa, Isapre" />}
        </Field>
      </div>
      <Field label="Mi historia: texto del perfil público" hint="Separa los párrafos con una línea en blanco.">
        {(x) => <Textarea {...x} rows={6} maxLength={4000} value={f.bio} onChange={cambiar('bio')} />}
      </Field>
      <Field label="Cita destacada (opcional)">{(x) => <Input {...x} value={f.citaDestacada} maxLength={300} onChange={cambiar('citaDestacada')} />}</Field>
      <div className="flex flex-col gap-4 rounded-[18px] border border-divider bg-bg p-4">
        {modo === 'propio' && (
          <Interruptor
            tono="team"
            etiqueta="Publicar mi perfil en la página del centro"
            descripcion="Solo tú decides publicarlo. Necesitas una tarifa general registrada."
            activo={opciones.perfilPublico}
            onChange={(v) => setOpciones((o) => ({ ...o, perfilPublico: v }))}
          />
        )}
        <Interruptor
          tono="team"
          etiqueta="Cobro directo"
          descripcion="El profesional cobra y emite su boleta; el centro no recibe esos pagos."
          activo={opciones.cobroDirecto}
          onChange={(v) => setOpciones((o) => ({ ...o, cobroDirecto: v }))}
        />
        <Interruptor
          tono="team"
          etiqueta="Boleta reembolsable"
          descripcion="Se indica en el perfil público para pacientes con seguro."
          activo={opciones.boletaReembolsable}
          onChange={(v) => setOpciones((o) => ({ ...o, boletaReembolsable: v }))}
        />
      </div>
      {estado.error && (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          {estado.error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {estado.ok && (
          <p role="status" className="m-0 mr-auto text-[13px] font-bold text-accent-2-800">
            Perfil guardado. Los cambios se ven en la página pública si está publicado.
          </p>
        )}
        <Button type="submit" variant="team" icon="save" loading={guardar.isPending}>
          {perfil ? 'Guardar perfil' : 'Crear perfil'}
        </Button>
      </div>
    </form>
  );
}
