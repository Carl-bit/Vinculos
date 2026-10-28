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
import { reglaCorreo, reglaObligatorio, reglaTelefono, useValidacionCampos } from '@/lib/validacion';

/** Datos de la cuenta que "Mi perfil" edita junto con el perfil (diseño "Admin - Mi Perfil"). */
export interface CuentaPerfil {
  nombre: string;
  email: string;
  telefono: string;
}

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
 *
 * Con `cuenta` (Mi perfil, 03b-4.1 pendiente 7): nombre, correo y telefono
 * van en el mismo formulario. "Guardar mi perfil" guarda en orden la cuenta
 * (PATCH usuarios/yo) y despues el perfil (PUT); cada error se muestra en su
 * parte. Una barra fija abajo se activa al haber cambios y permite
 * descartarlos.
 */
export function FormularioPerfil({
  modo,
  profesionalId,
  perfil,
  puedeFoto,
  cuenta,
}: {
  modo: 'propio' | 'equipo';
  profesionalId: string;
  perfil: PerfilProfesional | null;
  puedeFoto: boolean;
  cuenta?: CuentaPerfil;
}) {
  const cliente = useQueryClient();
  const cuentaInicial = useRef(cuenta ?? { nombre: '', email: '', telefono: '' });
  const [c, setC] = useState<CuentaPerfil>(cuentaInicial.current);
  const v = useValidacionCampos({ nombre: reglaObligatorio('Escribe tu nombre.'), email: reglaCorreo(true), telefono: reglaTelefono });
  const [errorCuenta, setErrorCuenta] = useState<string>();
  const inicial = useRef({
    especialidad: perfil?.especialidad ?? '',
    modalidad: perfil?.modalidad ?? ('PRESENCIAL' as PerfilProfesional['modalidad']),
    nombrePublico: perfil?.nombrePublico ?? '',
    bio: perfil?.bio ?? '',
    citaDestacada: perfil?.citaDestacada ?? '',
    enfoques: (perfil?.enfoques ?? []).join(', '),
    idiomas: (perfil?.idiomas ?? []).join(', '),
    convenios: (perfil?.convenios ?? []).join(', '),
  });
  const [f, setF] = useState(inicial.current);
  const opcionesIniciales = useRef({
    perfilPublico: perfil?.perfilPublico ?? false,
    cobroDirecto: perfil?.cobroDirecto ?? false,
    boletaReembolsable: perfil?.boletaReembolsable ?? false,
  });
  const [opciones, setOpciones] = useState(opcionesIniciales.current);
  const igual = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);
  const cambioCuenta = !!cuenta && !igual(c, cuentaInicial.current);
  const cambioPerfil = !igual(f, inicial.current) || !igual(opciones, opcionesIniciales.current);
  const hayCambios = cambioCuenta || cambioPerfil;
  const [foto, setFoto] = useState(perfil?.fotoUrl ?? null);
  const [estado, setEstado] = useState<{ error?: string; ok?: boolean }>({});
  const archivo = useRef<HTMLInputElement>(null);
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setEstado({});
    setF((x) => ({ ...x, [k]: e.target.value }));
  };

  const cambiarCuenta = (k: keyof CuentaPerfil) => (e: { target: { value: string } }) => {
    setEstado({});
    setErrorCuenta(undefined);
    v.limpiar(k);
    setC((x) => ({ ...x, [k]: e.target.value }));
  };
  const descartar = () => {
    setC(cuentaInicial.current);
    setF(inicial.current);
    setOpciones(opcionesIniciales.current);
    setEstado({});
    setErrorCuenta(undefined);
  };

  const guardarCuenta = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/usuarios/yo', {
          body: { nombre: c.nombre.trim(), email: c.email.trim().toLowerCase(), telefono: c.telefono.replace(/[\s()-]/g, '') || null },
        }),
      ),
    onSuccess: () => {
      cuentaInicial.current = c;
      void cliente.invalidateQueries({ queryKey: ['usuarios', 'yo'] });
    },
  });
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
      inicial.current = f;
      opcionesIniciales.current = opciones;
      void cliente.invalidateQueries({ queryKey: ['equipo', 'perfil', profesionalId] });
    },
  });
  /** Cuenta primero y despues perfil; si la cuenta falla, el perfil no se envia. */
  const guardarTodo = useMutation({
    mutationFn: async () => {
      if (cambioCuenta) {
        try {
          await guardarCuenta.mutateAsync();
        } catch (e) {
          setErrorCuenta(e instanceof ApiError ? e.message : 'No pudimos guardar tus datos de contacto.');
          throw e;
        }
      }
      if (cambioPerfil || !perfil) {
        try {
          await guardar.mutateAsync();
        } catch (e) {
          setEstado({ error: e instanceof ApiError ? e.message : 'No pudimos guardar el perfil.' });
          throw e;
        }
      }
    },
    onSuccess: () => setEstado({ ok: true }),
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
    if (cuenta && !v.validarTodo(c)) return;
    if (!f.especialidad.trim()) return setEstado({ error: 'La especialidad es obligatoria (por ejemplo, Psicología clínica).' });
    guardarTodo.mutate();
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
      {cuenta && (
        <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
          <legend className="mb-3 text-[12.5px] font-extrabold">Mis datos de contacto (no se publican)</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nombre" required error={v.errores.nombre}>
              {(x) => <Input {...x} value={c.nombre} maxLength={120} onChange={cambiarCuenta('nombre')} onBlur={() => v.alSalir('nombre', c.nombre)} />}
            </Field>
            <Field label="Correo" required error={v.errores.email} hint="Con él ingresas y te llega el código.">
              {(x) => (
                <Input {...x} type="email" autoComplete="email" value={c.email} onChange={cambiarCuenta('email')} onBlur={() => v.alSalir('email', c.email)} />
              )}
            </Field>
            <Field label="Teléfono" error={v.errores.telefono} hint="+56 9 1234 5678">
              {(x) => (
                <Input
                  {...x}
                  type="tel"
                  autoComplete="tel"
                  value={c.telefono}
                  onChange={cambiarCuenta('telefono')}
                  onBlur={() => v.alSalir('telefono', c.telefono)}
                />
              )}
            </Field>
          </div>
          {errorCuenta && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {errorCuenta}
            </p>
          )}
        </fieldset>
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
      {cuenta ? (
        // Barra fija (diseño): activa solo con cambios; descartar vuelve a lo guardado.
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-[18px] border border-divider bg-bg px-4 py-3 shadow-md">
          <p role="status" className="m-0 min-w-0 flex-1 text-[13px] font-bold text-neutral-800">
            {estado.ok && !hayCambios
              ? 'Perfil guardado. Los cambios se ven en la página pública si está publicado.'
              : hayCambios
                ? 'Tienes cambios sin guardar.'
                : 'Sin cambios.'}
          </p>
          <Button variant="ghost" icon="restart_alt" disabled={!hayCambios || guardarTodo.isPending} onClick={descartar}>
            Descartar cambios
          </Button>
          <Button type="submit" variant="team" icon="save" disabled={!hayCambios && !!perfil} loading={guardarTodo.isPending}>
            {perfil ? 'Guardar mi perfil' : 'Crear perfil'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="team" icon="save" loading={guardarTodo.isPending}>
            {perfil ? (modo === 'propio' ? 'Guardar mi perfil' : 'Guardar perfil') : 'Crear perfil'}
          </Button>
          {estado.ok ? (
            <p role="status" className="m-0 text-[13px] font-bold text-accent-2-800">
              Perfil guardado. Los cambios se ven en la página pública si está publicado.
            </p>
          ) : (
            modo === 'propio' && (
              <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Los cambios se reflejan también en mi perfil público del centro.</p>
            )
          )}
        </div>
      )}
    </form>
  );
}
