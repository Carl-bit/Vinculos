'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Aviso } from '@/components/ui/Aviso';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Icon } from '@/components/ui/Icon';
import { Panel } from '@/components/ui/Panel';
import { Select } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import { edadEn } from '@/lib/condiciones';
import { useProfesionales } from '@/lib/consultas';
import { formatoFechaHora, formatoTelefono } from '@/lib/formato';
import { NOMBRE_ROL } from '@/lib/roles';
import { hoyChile, useCitas, useDerivaciones, useEstadoFichas, usePacientes, usePerfilesPublicos, type EstadoFicha, type PacienteVista } from '@/lib/panel';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const diaSemana = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', weekday: 'short' });
const horaCorta = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const INDICE: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

type Orden = 'hora' | 'nombre' | 'estado';

/**
 * Vista administrativa de Fichas (diseño "Fichas Vista Administrativa"):
 * directorio del equipo, asignacion de pacientes y estado administrativo, con
 * aislamiento clinico (sin notas, motivos ni diagnosticos). Para ADMIN y
 * GESTION. "Agregar profesional" lo aporta la pagina (modulo Equipo).
 */
export function VistaAdministrativa({ agregarProfesional }: { agregarProfesional?: ReactNode }) {
  const profesionales = useProfesionales(true);
  const pacientes = usePacientes();
  const perfiles = usePerfilesPublicos();
  const hoy = hoyChile();
  const citasHoy = useCitas(hoy);
  const [elegido, setElegido] = useState<string>();
  const carga = new Map<string, number>();
  for (const p of pacientes.data ?? []) if (p.profesionalId) carga.set(p.profesionalId, (carga.get(p.profesionalId) ?? 0) + 1);
  const hoyPor = new Map<string, number>();
  for (const c of citasHoy.data ?? []) if (c.estado === 'CONFIRMADA') hoyPor.set(c.profesionalId, (hoyPor.get(c.profesionalId) ?? 0) + 1);
  // Primero quienes tienen mas pacientes asignados.
  const lista = [...(profesionales.data ?? [])].sort((a, b) => (carga.get(b.id) ?? 0) - (carga.get(a.id) ?? 0));
  const actual = lista.find((p) => p.id === (elegido ?? lista[0]?.id));

  return (
    <div className="flex flex-col gap-4">
      <Aviso tono="nota" icono="shield_person" titulo="Aislamiento clínico activo">
        Vista de coordinación y directorio. El secreto profesional impide ver notas de sesión, motivos de consulta y diagnósticos desde este perfil.
      </Aviso>
      <p className="m-0 flex flex-wrap justify-between gap-2 text-[12.5px] font-extrabold tracking-[0.06em] text-neutral-700 uppercase">
        <span>Directorio · profesionales del centro</span>
        <span className="font-semibold tracking-normal normal-case">{lista.length} · elige uno para ver su asignación</span>
      </p>
      <EstadoConsulta
        consulta={profesionales}
        vacio={() => lista.length === 0}
        textoVacio="Todavía no hay profesionales en el centro"
        accionVacio={agregarProfesional}
      >
        {() => (
          <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr))]">
            {lista.map((p) => {
              const perfil = perfiles.data?.find((x) => x.id === p.id);
              const activo = actual?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setElegido(p.id)}
                  className={`flex cursor-pointer flex-col gap-3 rounded-lg border bg-bg p-[18px] text-left shadow-sm transition-[box-shadow,border-color] duration-200 ease-out hover:shadow-lg ${
                    activo ? 'border-accent-600 ring-2 ring-accent-300' : 'border-divider'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <AvatarProfesional nombre={p.nombre ?? '?'} foto={perfil?.foto_url ?? null} size={44} />
                    {p.roles.includes('ADMIN') && <Badge>Cuenta madre</Badge>}
                  </div>
                  <div>
                    <p className="m-0 text-[15px] font-black tracking-[-0.02em]">{p.nombre ?? 'Sin nombre'}</p>
                    <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
                      {perfil?.especialidad || p.tiposAtencion.join(', ') || NOMBRE_ROL[p.rol]}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-between gap-2 border-t border-divider pt-2 text-[12px] font-extrabold text-neutral-700">
                    <span>{carga.get(p.id) ?? 0} pacientes</span>
                    <span>{hoyPor.get(p.id) ? `${hoyPor.get(p.id)} hoy` : 'Sin sesiones hoy'}</span>
                  </div>
                </button>
              );
            })}
            {agregarProfesional && (
              <div className="flex flex-col justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-neutral-400 p-[18px]">
                <p className="m-0 text-[15px] font-black">Agregar profesional</p>
                <p className="m-0 text-[12.5px] font-semibold text-neutral-700">Crea la cuenta y envía la invitación por correo.</p>
                {agregarProfesional}
              </div>
            )}
          </div>
        )}
      </EstadoConsulta>

      {actual && (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
          <FichaProfesional
            id={actual.id}
            nombre={actual.nombre ?? 'Sin nombre'}
            rol={NOMBRE_ROL[actual.rol]}
            email={actual.email}
            telefono={actual.telefono}
          />
          <PacientesDe profesionalId={actual.id} pacientes={(pacientes.data ?? []).filter((p) => p.profesionalId === actual.id)} />
        </div>
      )}
    </div>
  );
}

function FichaProfesional({ id, nombre, rol, email, telefono }: { id: string; nombre: string; rol: string; email: string | null; telefono: string | null }) {
  const desde = new Date();
  const hasta = new Date(desde.getTime() + 7 * 86_400_000);
  const bloques = useQuery({
    queryKey: ['panel', 'bloques', id, desde.toDateString()],
    queryFn: () =>
      datos(
        api.GET('/api/profesionales/{profesionalId}/bloques', {
          params: { path: { profesionalId: id }, query: { desde: desde.toISOString(), hasta: hasta.toISOString() } },
        }),
      ),
  });
  const derivaciones = useDerivaciones(true);
  const recibidas = (derivaciones.data ?? []).filter(
    (d) => d.estado === 'ACEPTADA' && d.candidatos.some((c) => c.profesionalId === id && c.estado === 'ACEPTADA'),
  ).length;
  const semana = (bloques.data ?? []).map((b) => ({
    dia: INDICE[diaSemana.format(new Date(b.inicio))]!,
    texto: `${horaCorta.format(new Date(b.inicio))}–${horaCorta.format(new Date(b.fin))}`,
  }));
  const horas = (bloques.data ?? []).reduce((s, b) => s + (new Date(b.fin).getTime() - new Date(b.inicio).getTime()) / 3_600_000, 0);
  return (
    <Panel titulo={nombre} bajada={rol}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="m-0 mb-2 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">Contacto de coordinación</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13.5px] font-semibold">
            <li className="flex items-center gap-2">
              <Icon name="mail" size={17} className="text-accent-700" />
              {email ?? 'Sin correo'}
            </li>
            <li className="flex items-center gap-2">
              <Icon name="smartphone" size={17} className="text-accent-700" />
              {telefono ? formatoTelefono(telefono) : 'Sin teléfono'}
            </li>
          </ul>
        </div>
        <div>
          <p className="m-0 mb-2 flex justify-between text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">
            <span>Horas de box apartadas (7 días)</span>
            <span className="tracking-normal normal-case">{Math.round(horas)} h</span>
          </p>
          {semana.length === 0 ? (
            <p className="m-0 text-[13px] font-semibold text-neutral-700">Sin horas apartadas esta semana.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {semana.slice(0, 12).map((b, i) => (
                <Badge key={i}>
                  {DIAS[b.dia]} {b.texto}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-divider pt-3">
          <Icon name="swap_horiz" size={20} className="text-accent-700" />
          <p className="m-0 flex-1 text-[13.5px] font-semibold">
            {recibidas === 0
              ? 'Sin pacientes recibidos por derivación'
              : `${recibidas} ${recibidas === 1 ? 'paciente recibido' : 'pacientes recibidos'} por derivación`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Icon name="receipt_long" size={20} className="text-accent-700" />
          <Link href={`/admin/cobros?profesional=${id}`} className="flex-1 text-[13.5px] font-extrabold">
            Ver liquidaciones y cobros
          </Link>
        </div>
      </div>
    </Panel>
  );
}

function PacientesDe({ profesionalId, pacientes }: { profesionalId: string; pacientes: PacienteVista[] }) {
  const estados = useEstadoFichas(profesionalId);
  const [orden, setOrden] = useState<Orden>('hora');
  const por = new Map((estados.data ?? []).map((e) => [e.paciente_id, e]));
  const ordenados = [...pacientes].sort((a, b) => {
    const ea = por.get(a.id);
    const eb = por.get(b.id);
    if (orden === 'nombre') return `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`);
    if (orden === 'estado') return (eb?.sesiones_sin_cerrar ?? 0) - (ea?.sesiones_sin_cerrar ?? 0);
    return (ea?.proxima_sesion ?? '9999').localeCompare(eb?.proxima_sesion ?? '9999');
  });
  return (
    <Panel
      titulo="Pacientes asignados"
      accion={
        <span className="flex items-center gap-2 text-[12.5px] font-extrabold">
          <span aria-hidden="true">Ordenar</span>
          <Select aria-label="Ordenar pacientes" value={orden} onChange={(e) => setOrden(e.target.value as Orden)} className="!w-auto !py-2 !text-[13px]">
            <option value="hora">Próxima sesión</option>
            <option value="nombre">Nombre</option>
            <option value="estado">Estado administrativo</option>
          </Select>
        </span>
      }
    >
      <EstadoConsulta consulta={estados} vacio={() => ordenados.length === 0} textoVacio="No tiene pacientes asignados">
        {() => (
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {ordenados.map((p) => (
              <FilaPaciente key={p.id} p={p} e={por.get(p.id)} />
            ))}
          </ul>
        )}
      </EstadoConsulta>
      <p className="m-0 mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
        <Icon name="lock" size={16} />
        Conforme al secreto profesional: sin contenido de sesión.
      </p>
    </Panel>
  );
}

function FilaPaciente({ p, e }: { p: PacienteVista; e?: EstadoFicha }) {
  const sinCerrar = e?.sesiones_sin_cerrar ?? 0;
  const estado = e?.alta_en
    ? { texto: 'Alta', tono: 'neutro' as const }
    : sinCerrar
      ? { texto: sinCerrar === 1 ? '1 sesión sin cerrar' : `${sinCerrar} sin cerrar`, tono: 'atencion' as const }
      : !p.rut
        ? { texto: 'Sin RUT', tono: 'atencion' as const }
        : { texto: 'Activo', tono: 'positivo' as const };
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[18px] border border-divider bg-bg px-4 py-3">
      <div className="min-w-0 flex-[1_1_200px]">
        <p className="m-0 flex flex-wrap items-center gap-2 text-[14.5px] font-extrabold">
          {p.nombre} {p.apellido}
          {edadEn(p.fechaNacimiento) < 18 && <Icon name="escalator_warning" size={16} label="Menor de edad" className="text-accent-700" />}
        </p>
        <p className="m-0 flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700">
          <Icon name="schedule" size={15} />
          {e?.proxima_sesion ? `Próxima: ${formatoFechaHora(e.proxima_sesion)}` : 'Sin próxima sesión'}
          {p.codigoSeudonimo ? ` · Ficha ${p.codigoSeudonimo}` : ''}
        </p>
      </div>
      <Badge tono={estado.tono}>{estado.texto}</Badge>
      <div className="flex gap-1.5">
        <ButtonLink href={`/admin/fichas/${p.id}`} variant="secondary" icon="folder_shared" className="!px-3.5 !py-2 !text-[12.5px]">
          Ver
        </ButtonLink>
        <ButtonLink href={`/admin/agenda?paciente=${p.id}`} variant="ghost" icon="event" className="!px-3.5 !py-2 !text-[12.5px]">
          Agendar
        </ButtonLink>
      </div>
    </li>
  );
}
