'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';

import { useEquipoActivo } from '@/components/shared/EquipoActivo';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Pestanas } from '@/components/ui/Pestanas';
import { Tabla, Td, Th } from '@/components/ui/Tabla';
import { edadEn } from '@/lib/condiciones';
import { useMiCuenta, useProfesionales } from '@/lib/consultas';
import { formatoFechaLarga } from '@/lib/formato';
import { useEstadoFichas, usePacientes, type EstadoFicha, type PacienteVista } from '@/lib/panel';
import { esAdministracion } from '@/lib/roles';
import type { Rol } from '@/lib/sesion';

type Filtro = 'todos' | 'sin-cerrar' | 'menores' | 'derivados' | 'sin-rut' | 'duplicados';

/**
 * Lista de pacientes (diseño "Fichas y Pacientes"): lo que la RLS deja ver al
 * rol activo (el profesional, los suyos; ADMIN/GESTION, todos). Estado de la
 * ficha solo con metadata (ultima sesion, sesiones sin evolucion). Recepcion
 * (ADMIN/GESTION) filtra por RUT faltante y posibles duplicados.
 */
export function ListaPacientes({ rol }: { rol: Rol }) {
  const admin = esAdministracion(rol);
  const router = useRouter();
  const parametros = useSearchParams();
  const filtro = (parametros.get('filtro') as Filtro | null) ?? 'todos';
  const [busqueda, setBusqueda] = useState('');
  const nombre = useDeferredValue(busqueda.trim());
  const { profesionalId } = useEquipoActivo();
  const cuenta = useMiCuenta();
  const consulta = usePacientes({
    nombre: nombre.length >= 2 ? nombre : undefined,
    profesionalId: admin ? (profesionalId ?? undefined) : undefined,
    menores: filtro === 'menores' || undefined,
    derivados: filtro === 'derivados' || undefined,
    duplicados: filtro === 'duplicados' || undefined,
  });
  // Estado de fichas: el profesional el suyo; administracion el del profesional elegido en el selector de equipo.
  const estados = useEstadoFichas(admin ? (profesionalId ?? undefined) : cuenta.data?.id);
  const porPaciente = new Map((estados.data ?? []).map((e) => [e.paciente_id, e]));
  const profesionales = useProfesionales(true);
  const equipo = new Map((profesionales.data ?? []).map((p) => [p.id, p.nombre ?? 'Profesional']));

  const pestanas: { valor: Filtro; etiqueta: string }[] = admin
    ? [
        { valor: 'todos', etiqueta: 'Todos' },
        { valor: 'sin-rut', etiqueta: 'Sin RUT' },
        { valor: 'duplicados', etiqueta: 'Posibles duplicados' },
        { valor: 'menores', etiqueta: 'Menores' },
      ]
    : [
        { valor: 'todos', etiqueta: 'Todos' },
        { valor: 'sin-cerrar', etiqueta: 'Sin cerrar' },
        { valor: 'menores', etiqueta: 'Menores' },
        { valor: 'derivados', etiqueta: 'Derivados a mí' },
      ];
  const elegir = (f: Filtro) => router.replace(f === 'todos' ? '/admin/fichas' : `/admin/fichas?filtro=${f}`, { scroll: false });
  const lista = (consulta.data ?? []).filter((p) => {
    if (filtro === 'sin-rut') return !p.rut;
    if (filtro === 'sin-cerrar') return (porPaciente.get(p.id)?.sesiones_sin_cerrar ?? 0) > 0;
    return true;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pestanas etiqueta="Filtrar pacientes" tono="team" valor={filtro} onChange={elegir} pestanas={pestanas} />
        <div className="relative w-full max-w-[320px]">
          <Icon name="search" size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-neutral-700" />
          <Input
            type="search"
            aria-label="Buscar paciente por nombre o apellido"
            placeholder="Buscar por nombre o apellido"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="!py-2.5 !pl-11 !text-[14px]"
          />
        </div>
      </div>
      <p className="m-0 flex items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
        <Icon name="visibility" size={16} />
        {admin
          ? profesionalId
            ? `Pacientes de ${equipo.get(profesionalId) ?? 'el profesional elegido'} (cambia el equipo en el menú lateral).`
            : 'Todos los pacientes del centro. Sin contenido clínico: solo datos administrativos.'
          : 'Tus pacientes y los que recibiste por derivación.'}
      </p>
      <EstadoConsulta
        consulta={consulta}
        vacio={() => lista.length === 0}
        textoVacio={nombre ? 'Ningún paciente coincide con la búsqueda' : filtro === 'todos' ? 'Todavía no hay pacientes' : 'Nada en este filtro'}
      >
        {() => (
          <Tabla etiqueta="Pacientes">
            <thead>
              <tr>
                <Th>Paciente</Th>
                <Th>Profesional a cargo</Th>
                <Th>Última sesión</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <Fila
                  key={p.id}
                  p={p}
                  estado={porPaciente.get(p.id)}
                  tratante={p.profesionalId ? equipo.get(p.profesionalId) : undefined}
                  onAbrir={() => router.push(`/admin/fichas/${p.id}`)}
                />
              ))}
            </tbody>
          </Tabla>
        )}
      </EstadoConsulta>
    </div>
  );
}

function Fila({ p, estado, tratante, onAbrir }: { p: PacienteVista; estado?: EstadoFicha; tratante?: string; onAbrir: () => void }) {
  const menor = edadEn(p.fechaNacimiento) < 18;
  const est = estadoAdministrativo(p, estado);
  return (
    <tr className="cursor-pointer transition-colors duration-200 hover:bg-accent-100" onClick={onAbrir}>
      <Td>
        <a
          href={`/admin/fichas/${p.id}`}
          onClick={(e) => {
            e.preventDefault();
            onAbrir();
          }}
          className="text-[14.5px] font-extrabold tracking-[-0.01em] text-text hover:text-accent-700"
        >
          {p.nombre} {p.apellido}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
          {menor && (
            <span className="inline-flex items-center gap-1 text-accent-800">
              <Icon name="escalator_warning" size={15} />
              Menor de edad
            </span>
          )}
          {!p.rut && <span className="text-accent-800">Sin RUT</span>}
          {p.posibleDuplicado && <span className="text-accent-800">Posible duplicado</span>}
        </div>
      </Td>
      <Td className="font-semibold">{tratante ?? '—'}</Td>
      <Td className="font-semibold text-neutral-800">{estado?.ultima_sesion ? formatoFechaLarga(estado.ultima_sesion) : '—'}</Td>
      <Td>
        <Badge tono={est.tono}>{est.texto}</Badge>
      </Td>
    </tr>
  );
}

function estadoAdministrativo(p: PacienteVista, e?: EstadoFicha): { texto: string; tono: 'positivo' | 'atencion' | 'neutro' } {
  if (e?.alta_en) return { texto: 'Alta', tono: 'neutro' };
  if ((e?.sesiones_sin_cerrar ?? 0) > 0) return { texto: 'Sesión sin cerrar', tono: 'atencion' };
  if (p.posibleDuplicado) return { texto: 'Por conciliar', tono: 'atencion' };
  if (e?.proxima_sesion) return { texto: 'Con hora', tono: 'positivo' };
  return { texto: 'Activa', tono: 'positivo' };
}
