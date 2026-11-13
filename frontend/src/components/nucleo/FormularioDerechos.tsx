'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { CampoRut, rutNormalizado } from '@/components/shared/CampoRut';
import { TarjetaIngreso, TituloIngreso } from '@/components/shared/TarjetaIngreso';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Casilla } from '@/components/ui/Casilla';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { rutValido } from '@/lib/formato';

type Tipo = components['schemas']['SolicitudDerechoPublicaDto']['tipo'];

const TIPOS: { valor: Tipo; texto: string }[] = [
  { valor: 'ACCESO', texto: 'Acceso: saber qué datos tiene el centro sobre mí' },
  { valor: 'RECTIFICACION', texto: 'Rectificación: corregir un dato' },
  { valor: 'CANCELACION', texto: 'Cancelación: eliminar mis datos' },
  { valor: 'OPOSICION', texto: 'Oposición: que no se usen para algo' },
  { valor: 'PORTABILIDAD', texto: 'Portabilidad: recibir mis datos en formato estructurado' },
  { valor: 'BLOQUEO', texto: 'Bloqueo: suspender su uso mientras se revisa' },
];

/**
 * AUD-01 (E2.3b, ARCOP-08): solicitud de derechos sin cuenta, por RUT. La
 * respuesta es siempre la misma (no revela si el RUT es de un paciente: ser
 * paciente de un centro psicologico ya es un dato de salud). Si lo es, la
 * respuesta llega solo al correo registrado; el correo no se cambia aca.
 */
export function FormularioDerechos() {
  const [rut, setRut] = useState('');
  const [tipo, setTipo] = useState<Tipo>('ACCESO');
  const [detalle, setDetalle] = useState('');
  const [cambiarCorreo, setCambiarCorreo] = useState(false);
  const [sitioWeb, setSitioWeb] = useState('');
  const [error, setError] = useState<string>();
  const enviar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/publico/derechos', {
          body: { rut: rutNormalizado(rut), tipo, detalle: detalle.trim() || undefined, cambiarCorreo: cambiarCorreo || undefined, sitioWeb: sitioWeb || undefined },
        }),
      ),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos enviar la solicitud. Intenta de nuevo.'),
  });
  const alEnviar = (e: FormEvent) => {
    e.preventDefault();
    if (!rutValido(rut)) return setError('Revisa el RUT: el dígito verificador no calza.');
    setError(undefined);
    enviar.mutate();
  };

  if (enviar.data) {
    return (
      <TarjetaIngreso>
        <TituloIngreso titulo="Solicitud enviada" />
        <Aviso tono="exito" role="status">
          {enviar.data.mensaje}
        </Aviso>
        <p className="m-0 mt-4 text-[13.5px] font-semibold text-neutral-800">
          El plazo para responder es de 30 días hábiles. <Link href="/" className="font-extrabold underline underline-offset-2">Volver al inicio</Link>
        </p>
      </TarjetaIngreso>
    );
  }
  return (
    <TarjetaIngreso>
      <TituloIngreso
        titulo="Derechos sobre tus datos"
        bajada="Pide acceso, corrección, eliminación, oposición, portabilidad o bloqueo de tus datos personales. Te responderemos al correo que el centro tiene registrado."
      />
      <form onSubmit={alEnviar} className="flex flex-col gap-4" noValidate>
        <CampoRut label="Tu RUT" required value={rut} onChange={setRut} autoComplete="off" />
        <Field label="Qué necesitas" required>
          {(p) => (
            <Select {...p} value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.texto}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Detalle" hint="Opcional. No incluyas información de salud.">
          {(p) => <Textarea {...p} rows={3} maxLength={2000} value={detalle} onChange={(e) => setDetalle(e.target.value)} />}
        </Field>
        <Casilla checked={cambiarCorreo} onChange={setCambiarCorreo}>
          Mi correo cambió: quiero actualizarlo. El centro verificará tu identidad antes de cambiarlo.
        </Casilla>
        {/* Trampa para bots: oculta para las personas. */}
        <input type="text" name="sitioWeb" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={sitioWeb} onChange={(e) => setSitioWeb(e.target.value)} />
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        <Button type="submit" loading={enviar.isPending}>
          Enviar solicitud
        </Button>
      </form>
    </TarjetaIngreso>
  );
}
