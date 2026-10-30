'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { TarjetaIngreso, TituloIngreso } from '@/components/shared/TarjetaIngreso';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { ApiError } from '@/lib/api/errores';
import { useSesion } from '@/lib/consultas';
import { guardarBlob, pedirArchivo, pedirArchivoPublico } from '@/lib/descargas';

/**
 * AUD-01 Fase 3: copia de los datos del paciente. La recibe el paciente y/o
 * su adulto responsable segun la edad. Con cuenta (paciente o RESPONSABLE),
 * se descarga con su sesion; sin cuenta, con el codigo del segundo correo. JSON para llevar a
 * otro sistema; PDF para leer. El enlace vence en 72 horas.
 */
export function DescargaExportacion() {
  const token = useSearchParams().get('token') ?? '';
  const sesion = useSesion();
  const rol = sesion.tipo === 'activa' ? sesion.sesion.rol : null;
  const conSesion = rol === 'PACIENTE' || rol === 'RESPONSABLE';
  const archivo = rol === 'RESPONSABLE' ? 'datos-paciente' : 'mis-datos';
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string>();
  const [cargando, setCargando] = useState<'json' | 'pdf' | null>(null);
  const bajar = async (formato: 'json' | 'pdf') => {
    if (!conSesion && !/^\d{8}$/.test(codigo)) return setError('Escribe el código de 8 dígitos que llegó en el otro correo.');
    setError(undefined);
    setCargando(formato);
    try {
      const blob = conSesion
        ? await pedirArchivo('/api/portal/exportacion/descarga', { token, formato })
        : await pedirArchivoPublico('/api/publico/exportacion/descarga', { token, codigo, formato });
      guardarBlob(blob, `${archivo}.${formato}`);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 403
          ? conSesion
            ? 'Este enlace es de otra cuenta.'
            : 'El código no es correcto. Si tienes cuenta, inicia sesión y vuelve a abrir el enlace.'
          : e instanceof ApiError && e.status === 404
            ? 'El enlace venció o no existe. Pide una nueva copia al centro.'
            : 'No pudimos descargar el archivo. Intenta de nuevo.',
      );
    } finally {
      setCargando(null);
    }
  };
  return (
    <TarjetaIngreso>
      <TituloIngreso
        titulo={rol === 'PACIENTE' ? 'Tu copia de datos' : 'Copia de datos'}
        bajada={
          rol === 'RESPONSABLE'
            ? 'El centro preparó la copia de los datos de la persona que tienes a cargo. Descárgala en el formato que necesites: el enlace vence en 72 horas.'
            : 'El centro preparó la copia de datos que se pidió. Descárgala en el formato que necesites: el enlace vence en 72 horas.'
        }
      />
      {!token ? (
        <Aviso tono="advertencia">Falta el enlace del correo. Ábrelo desde el correo que te envió el centro.</Aviso>
      ) : (
        <div className="flex flex-col gap-4">
          {!conSesion && (
            <Field label="Código" hint="8 dígitos, en el segundo correo. Si tienes cuenta, inicia sesión y vuelve a abrir el enlace.">
              {(p) => <Input {...p} inputMode="numeric" maxLength={8} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />}
            </Field>
          )}
          <div className="flex flex-wrap gap-2.5">
            <Button icon="description" loading={cargando === 'pdf'} onClick={() => void bajar('pdf')}>
              Descargar PDF (para leer)
            </Button>
            <Button variant="secondary" icon="download" loading={cargando === 'json'} onClick={() => void bajar('json')}>
              Descargar JSON (para otro sistema)
            </Button>
          </div>
          {error && (
            <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
              {error}
            </p>
          )}
          {!conSesion && (
            <p className="m-0 text-[13px] font-semibold text-neutral-800">
              ¿Tienes cuenta?{' '}
              <Link href={`/portal/exportacion?token=${encodeURIComponent(token)}`} className="font-extrabold underline underline-offset-2">
                Descárgala desde tu portal
              </Link>
              .
            </p>
          )}
        </div>
      )}
    </TarjetaIngreso>
  );
}
