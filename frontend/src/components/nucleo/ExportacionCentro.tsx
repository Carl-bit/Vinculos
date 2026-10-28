'use client';

import { useState } from 'react';

import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { ApiError } from '@/lib/api/errores';
import { guardarBlob, pedirArchivo } from '@/lib/descargas';

/**
 * AUD-01 Fase 3 (LEG-04): exportacion completa del centro, cifrada con una
 * clave que elige la cuenta madre. Vinculos no guarda la clave ni el archivo:
 * sin la clave nadie lo abre, tampoco Vinculos. Incluye fichas clinicas: es la
 * entrega de los datos al responsable del centro.
 */
export function ExportacionCentro() {
  const [clave, setClave] = useState('');
  const [repetir, setRepetir] = useState('');
  const [error, setError] = useState<string>();
  const [listo, setListo] = useState(false);
  const [cargando, setCargando] = useState(false);
  const exportar = async () => {
    if (clave.length < 16) return setError('La clave debe tener al menos 16 caracteres.');
    if (clave !== repetir) return setError('Las claves no coinciden.');
    setError(undefined);
    setCargando(true);
    try {
      const blob = await pedirArchivo('/api/exportacion-centro', { clave });
      guardarBlob(blob, `exportacion-centro-${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })}.vxp`);
      setListo(true);
      setClave('');
      setRepetir('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos generar la exportación.');
    } finally {
      setCargando(false);
    }
  };
  return (
    <Panel
      titulo="Exportación completa del centro"
      bajada="Todos los datos del centro (pacientes, fichas, agenda, equipo, cobros, políticas y auditoría) en un archivo cifrado, para conservarlos o llevarlos a otro sistema."
    >
      <div className="mt-4 flex flex-col gap-4">
        <Aviso tono="nota" titulo="Guarda la clave en un lugar seguro">
          Vinculos no guarda la clave ni el archivo: sin la clave nadie puede abrirlo, tampoco Vinculos. El archivo incluye las fichas
          clínicas: entrégalo solo a quien responde legalmente por ellas. La exportación queda registrada en la auditoría.
        </Aviso>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Clave" required hint="Al menos 16 caracteres. Una frase larga es más fácil de recordar.">
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} />}
          </Field>
          <Field label="Repite la clave" required>
            {(p) => <Input {...p} type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} />}
          </Field>
        </div>
        <div className="flex justify-end">
          <Button variant="team" icon="download" loading={cargando} onClick={() => void exportar()}>
            Generar y descargar
          </Button>
        </div>
        {error && (
          <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
            {error}
          </p>
        )}
        {listo && (
          <Aviso tono="exito" role="status">
            Archivo descargado. Para abrirlo: <code>CLAVE=&apos;tu clave&apos; node descifrar.mjs archivo.vxp carpeta</code> (script entregado por Vinculos;
            deja un JSON por tabla y un PDF por ficha).
          </Aviso>
        )}
      </div>
    </Panel>
  );
}
