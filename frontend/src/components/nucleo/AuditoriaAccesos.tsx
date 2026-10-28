'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Field, Input, Select } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { api, datos } from '@/lib/api/cliente';
import type { paths } from '@/lib/api/esquema';
import { formatoFechaHora } from '@/lib/formato';
import { NOMBRE_ROL } from '@/lib/roles';

type Accion = NonNullable<NonNullable<paths['/api/auditoria/accesos']['get']['parameters']['query']>['accion']>;

const ACCIONES: { valor: Accion; texto: string }[] = [
  { valor: 'LECTURA', texto: 'Lectura' },
  { valor: 'ESCRITURA', texto: 'Escritura o edición' },
  { valor: 'DESCARGA', texto: 'Descarga' },
  { valor: 'EXPORTACION', texto: 'Exportación' },
  { valor: 'ENVIO', texto: 'Envío' },
  { valor: 'DERIVACION', texto: 'Derivación' },
  { valor: 'SUPERVISION', texto: 'Supervisión' },
  { valor: 'RETENCION', texto: 'Revisión de retención' },
  { valor: 'ACCESO_TEMPORAL', texto: 'Acceso temporal' },
];
const TEXTO_ACCION = new Map<string, string>(ACCIONES.map((a) => [a.valor, a.texto]));

/** Nombre legible del recurso; si no esta, el de la tabla. */
const RECURSOS: Record<string, string> = {
  pacientes: 'Datos del paciente',
  adultos_responsables: 'Adulto responsable',
  fichas_clinicas: 'Ficha clínica',
  evoluciones: 'Evoluciones',
  ingresos_ficha: 'Ficha de ingreso',
  adjuntos_ficha: 'Adjuntos de la ficha',
  documentos_clinicos: 'Documentos clínicos',
  envios_documento: 'Envío de documento',
  transferencias: 'Comprobante de transferencia',
  mensajes_internos: 'Mensajería interna',
  respuestas_match: 'Respuestas del match',
  reporte_cobros: 'Reporte de cobros (PDF)',
  liquidaciones: 'Liquidación (PDF)',
  derivaciones: 'Derivación',
  derivaciones_pendientes: 'Derivaciones pendientes',
  derivacion_candidatos: 'Candidatos de derivación',
  oferta_derivacion: 'Oferta de derivación',
  consentimientos: 'Consentimiento',
  supervision_casos: 'Casos en supervisión',
  supervision_evoluciones: 'Evoluciones en supervisión',
  accesos_clinicos_temporales: 'Acceso clínico temporal',
  altas_paciente: 'Alta del paciente',
};

/** Campos editados (accesos_ficha.detalle = "campos: a, b"), en palabras. */
const CAMPOS: Record<string, string> = {
  nombre: 'nombre',
  apellido: 'apellido',
  rut: 'RUT',
  fecha_nacimiento: 'fecha de nacimiento',
  email: 'correo',
  telefono: 'teléfono',
  contacto_emergencia: 'contacto de emergencia',
  profesional_id: 'profesional tratante',
  tipo_atencion_id: 'tipo de atención',
  traido_por_centro: 'origen (llegó por el centro)',
  posible_duplicado: 'posible duplicado',
  deleted_at: 'eliminación lógica',
  parentesco: 'parentesco',
  usuario_id: 'cuenta del portal',
  creado_por_solicitud: 'origen (solicitud del portal)',
};
const detalleLegible = (d: string | null) =>
  !d
    ? ''
    : d.startsWith('campos: ')
      ? `Campos: ${d
          .slice(8)
          .split(', ')
          .map((c) => CAMPOS[c] ?? c)
          .join(', ')}`
      : d;

/** Pacientes y adultos responsables no estan en el directorio del equipo. */
const quien = (nombre: string | null, rol: keyof typeof NOMBRE_ROL) =>
  nombre ?? (rol === 'PACIENTE' ? 'El propio paciente' : rol === 'RESPONSABLE' ? 'Adulto responsable' : 'Ex integrante del equipo');

const diaChile = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

/**
 * AUD-01 (E1.5, CENS-S3): quien vio, escribio, descargo o exporto datos, con
 * su rol activo. Solo ADMIN. La edicion de datos personales muestra los
 * campos que cambiaron, nunca los valores. Por defecto, los ultimos 7 dias.
 */
export function AuditoriaAccesos() {
  const [desde, setDesde] = useState(() => diaChile(new Date(Date.now() - 6 * 86_400_000)));
  const [hasta, setHasta] = useState(() => diaChile(new Date()));
  const [accion, setAccion] = useState<Accion | ''>('');
  const valido = !!desde && !!hasta && desde <= hasta;
  const consulta = useQuery({
    queryKey: ['auditoria', 'accesos', desde, hasta, accion],
    enabled: valido,
    queryFn: () =>
      datos(
        api.GET('/api/auditoria/accesos', {
          params: {
            query: {
              desde: new Date(`${desde}T00:00:00-03:00`).toISOString(),
              // Fin excluido: el dia siguiente al elegido.
              hasta: new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86_400_000).toISOString(),
              accion: accion || undefined,
            },
          },
        }),
      ),
  });

  return (
    <Panel
      titulo="Auditoría de accesos"
      bajada="Quién vio, editó, descargó o exportó datos del centro, cuándo y con qué rol activo. Las ediciones muestran los campos que cambiaron, nunca los valores."
    >
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Desde">{(p) => <Input {...p} type="date" max={hasta} value={desde} onChange={(e) => setDesde(e.target.value)} />}</Field>
        <Field label="Hasta">{(p) => <Input {...p} type="date" min={desde} value={hasta} onChange={(e) => setHasta(e.target.value)} />}</Field>
        <Field label="Acción">
          {(p) => (
            <Select {...p} value={accion} onChange={(e) => setAccion(e.target.value as Accion | '')}>
              <option value="">Todas</option>
              {ACCIONES.map((a) => (
                <option key={a.valor} value={a.valor}>
                  {a.texto}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <p className="mt-2 mb-4 text-[12.5px] font-semibold text-neutral-800">Se muestran hasta 300 registros, del más reciente al más antiguo.</p>
      {!valido ? (
        <p role="alert" className="m-0 text-[13px] font-bold text-accent-700">
          La fecha de inicio debe ser anterior o igual a la de término.
        </p>
      ) : (
        <EstadoConsulta consulta={consulta} vacio={(f) => f.length === 0} textoVacio="Sin registros en el período">
          {(filas) => (
            <Tabla etiqueta="Registros de auditoría">
              <thead>
                <tr>
                  <Th>Fecha y hora</Th>
                  <Th>Quién</Th>
                  <Th>Paciente</Th>
                  <Th>Qué</Th>
                  <Th>Acción</Th>
                  <Th>Detalle</Th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={`${f.origen}-${f.id}`}>
                    <Td className="whitespace-nowrap tabular-nums">{formatoFechaHora(f.ocurridoEn)}</Td>
                    <Td>
                      <span className="font-bold">{quien(f.usuarioNombre, f.rol)}</span>
                      <span className="block text-[12.5px] font-semibold text-neutral-700">{NOMBRE_ROL[f.rol]}</span>
                    </Td>
                    <Td>{f.pacienteNombre ?? <span className="text-neutral-700">—</span>}</Td>
                    <Td>{RECURSOS[f.recurso] ?? f.recurso}</Td>
                    <Td>{TEXTO_ACCION.get(f.accion) ?? f.accion}</Td>
                    <Td className="min-w-[180px] text-[13px] text-neutral-800">{detalleLegible(f.detalle)}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabla>
          )}
        </EstadoConsulta>
      )}
    </Panel>
  );
}
