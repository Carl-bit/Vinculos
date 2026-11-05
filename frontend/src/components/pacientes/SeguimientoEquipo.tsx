'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Textarea } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import {
  ALCANCE_ACCESO,
  MOTIVO_ACCESO,
  accesoVigente,
  useAccesosRecibidos,
  useConsentimientosEquipo,
  useDerivacionesLista,
  usePendientesDerivacion,
} from '@/lib/derivaciones';
import { usePracticantes, useSupervisiones } from '@/lib/equipo';
import { diasHasta, plazoEvolucion, sinEvolucionPorPaciente, usePendientesFichas, type PendienteFicha } from '@/lib/fichas';
import { formatoFechaCorta, formatoHora } from '@/lib/formato';
import { hoyChile, useCitas, useEquipoAgenda, usePacientes, type MiembroDirectorio } from '@/lib/panel';
import type { Rol } from '@/lib/sesion';

import { AgendaProfesional } from './AgendaProfesional';

type Grupo = 'sc' | 'con' | 'dat' | 'der' | 'acc' | 'prac';
type Tono = 'vencido' | 'pronto' | 'plazo' | 'ok';

const CHIP: Record<Tono, string> = {
  vencido: 'bg-accent-200 text-accent-900',
  pronto: 'bg-pendiente-100 text-pendiente-900',
  plazo: 'bg-neutral-200 text-neutral-800',
  ok: 'bg-accent-2-200 text-accent-2-900',
};

const GRUPOS: { g: Grupo; titulo: string; nota: string; color: string }[] = [
  { g: 'sc', titulo: 'Sesiones sin cerrar', nota: 'Plazo para registrar la evolución según Configuración', color: 'text-accent-800' },
  { g: 'con', titulo: 'Consentimientos', nota: 'Sin consentimiento vigente no se confirma la atención', color: 'text-pendiente-900' },
  { g: 'dat', titulo: 'Datos administrativos', nota: 'Los completa recepción', color: 'text-pendiente-900' },
  { g: 'der', titulo: 'Derivaciones', nota: 'Puedes reordenar o reasignar candidatos, no crear la derivación', color: 'text-text' },
  { g: 'acc', titulo: 'Accesos temporales', nota: '', color: 'text-text' },
  { g: 'prac', titulo: 'Prácticas supervisadas', nota: 'El supervisor revisa sin ver datos de contacto del paciente', color: 'text-accent-2-800' },
];

/** Detalle de un pendiente para el panel de intervencion. */
interface Detalle {
  tipo: string;
  titulo: string;
  datos: [string, string][];
  lista?: { titulo: string; filas: { n: string; l: string; e: string; actual?: boolean }[] };
  mensaje?: { asunto: string; texto: string };
  acciones: ReactNode;
  regla: string;
}

interface Item {
  key: string;
  grupo: Grupo;
  code: string;
  titulo: string;
  detalle: string;
  plazo: { texto: string; tono: Tono };
  det: Detalle;
}

const fechas = (lista: PendienteFicha[]) => {
  const f = lista.map((s) => formatoFechaCorta(s.fecha!));
  return f.length > 1 ? `${f.slice(0, -1).join(', ')} y ${f.at(-1)}` : (f[0] ?? '');
};
const horasHasta = (iso: string | null) => (iso === null ? 0 : Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000)));
const proxima = (fecha: string | null) => (fecha ? `${formatoFechaCorta(fecha)}, ${formatoHora(fecha)}` : 'sin hora');
const plazoSesion = (fecha: string | null): { texto: string; tono: Tono } => {
  if (!fecha) return { texto: 'Sin hora', tono: 'plazo' };
  const d = diasHasta(fecha);
  return d <= 0 ? { texto: 'Sesión hoy', tono: 'vencido' } : { texto: d === 1 ? 'Sesión mañana' : `Sesión en ${d} días`, tono: d <= 2 ? 'pronto' : 'plazo' };
};
const iniciales = (nombre: string) =>
  nombre
    .replace(/\(.*\)/, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/**
 * Seguimiento del equipo (diseño "Administrador seguimiento del trabajo de
 * cada profesional"): que necesita atencion en el centro, el trabajo
 * pendiente de cada profesional y un panel para intervenir (preguntar por
 * mensajeria interna, reenviar un consentimiento, completar datos). Los
 * pacientes se identifican solo por el codigo de su ficha y nunca se ve
 * contenido clinico: la administracion sabe que una sesion no tiene
 * evolucion y su plazo, no que dice. GESTION no ve derivaciones ni accesos
 * (matriz de permisos).
 */
export function SeguimientoEquipo({ rol, agregarProfesional }: { rol: Rol; agregarProfesional?: ReactNode }) {
  const admin = rol === 'ADMIN';
  const equipo = useEquipoAgenda();
  const pacientes = usePacientes();
  const pendientes = usePendientesFichas();
  const citasHoy = useCitas(hoyChile());
  const derivaciones = useDerivacionesLista(undefined, admin);
  const bandeja = usePendientesDerivacion(admin);
  const accesos = useAccesosRecibidos(admin);
  const supervisiones = useSupervisiones();
  const practicantes = usePracticantes();
  const consentimientos = useConsentimientosEquipo(true);
  const [elegido, setElegido] = useState<string>();
  const [itemElegido, setItemElegido] = useState<string>();
  const [foco, setFoco] = useState<Grupo | null>(null);

  const miembros = equipo.data ?? [];
  const nombre = new Map(miembros.map((m) => [m.id, m.nombre ?? 'Integrante']));
  const codigo = new Map((pacientes.data ?? []).map((p) => [p.id, p.codigoSeudonimo ?? 'Ficha']));
  const tratanteDe = new Map((pacientes.data ?? []).map((p) => [p.id, p.profesionalId]));
  const pend = pendientes.data ?? [];
  const activas = (derivaciones.data ?? []).filter((d) => ['PENDIENTE', 'ESPERANDO_CONSENTIMIENTO', 'SIN_ASIGNAR'].includes(d.estado));
  const vigentes = (accesos.data ?? []).filter((a) => accesoVigente(a));
  const supervisionesVigentes = (supervisiones.data ?? []).filter((s) => !s.hasta);
  const termino = new Map((practicantes.data ?? []).map((p) => [p.usuarioId, p.fechaTerminoPractica]));

  /** Pendientes de un integrante, ya armados para la lista y el panel de intervencion. */
  const itemsDe = (m: MiembroDirectorio): Item[] => {
    const items: Item[] = [];
    const propios = pend.filter((p) => p.profesional_id === m.id);
    const nom = m.nombre ?? 'el profesional';
    const pregunta = (code: string, asunto: string, texto: string) => ({ asunto: `Ficha ${code}: ${asunto}`, texto });
    for (const g of sinEvolucionPorPaciente(propios)) {
      const plazoDias = Math.round((new Date(g.sesiones[0]!.vence!).getTime() - new Date(g.sesiones[0]!.fecha!).getTime()) / 86_400_000);
      const n = g.sesiones.length;
      const titulo = n === 1 ? '1 sesión sin evolución' : `${n} sesiones sin evolución`;
      items.push({
        key: `sc-${g.pacienteId}`,
        grupo: 'sc',
        code: g.codigo,
        titulo,
        detalle: `${fechas(g.sesiones)} · plazo de ${plazoDias} días`,
        plazo: plazoEvolucion(g.sesiones[0]!.vence!),
        det: {
          tipo: `Sesión sin cerrar · ${g.codigo}`,
          titulo,
          datos: [
            ['Tratante', nom],
            ['Sesiones', fechas(g.sesiones)],
            ['Plazo', plazoEvolucion(g.sesiones[0]!.vence!).texto],
          ],
          mensaje: pregunta(
            g.codigo,
            'sesiones sin evolución',
            `Hola: la ficha ${g.codigo} tiene ${titulo.toLowerCase()} (${fechas(g.sesiones)}). ¿Te falta algo para cerrarla o necesitas apoyo?`,
          ),
          acciones: null,
          regla:
            'La administración ve que la sesión existe y su plazo, nunca el contenido de la evolución. El recordatorio automático al profesional sale según Configuración › Avisos.',
        },
      });
    }
    for (const p of propios.filter((x) => x.tipo === 'CONSENTIMIENTO')) {
      const otorga = p.menor ? 'Su adulto responsable' : 'El paciente';
      items.push({
        key: `con-${p.paciente_id}`,
        grupo: 'con',
        code: p.codigo,
        titulo: p.menor ? 'Consentimiento pendiente de un menor' : 'Consentimiento informado sin aceptar',
        detalle: `Próxima sesión ${proxima(p.fecha)} · lo otorga ${otorga.toLowerCase()}`,
        plazo: plazoSesion(p.fecha),
        det: {
          tipo: `Consentimiento · ${p.codigo}`,
          titulo: 'Consentimiento informado de atención',
          datos: [
            ['Lo otorga', otorga],
            ['Próxima sesión', proxima(p.fecha)],
            ['Estado', 'Sin aceptar la versión vigente'],
          ],
          mensaje: pregunta(
            p.codigo,
            'consentimiento pendiente',
            `Hola: el consentimiento de la ficha ${p.codigo} sigue pendiente. Lo reenvío por correo; si prefieres, se firma en el centro en la próxima sesión.`,
          ),
          acciones: (
            <>
              <EnviarEnlace pacienteId={p.paciente_id} />
              <ButtonLink href={`/admin/fichas/${p.paciente_id}?vista=consentimientos`} variant="secondary" className="!px-4 !py-2.5 !text-[13px]">
                Registrar firmado en el centro
              </ButtonLink>
            </>
          ),
          regla: 'El enlace va al correo registrado (del adulto responsable si es menor). Tú no ves el contenido de la ficha.',
        },
      });
    }
    for (const p of propios.filter((x) => x.tipo === 'SIN_RUT' || x.tipo === 'SIN_RESPONSABLE')) {
      const rut = p.tipo === 'SIN_RUT';
      items.push({
        key: `dat-${p.tipo}-${p.paciente_id}`,
        grupo: 'dat',
        code: p.codigo,
        titulo: rut ? 'Sin RUT' : 'Menor sin adulto responsable',
        detalle: rut ? `Se exige antes de la primera evolución · sesión ${proxima(p.fecha)}` : `Sin él no se confirman sus horas · sesión ${proxima(p.fecha)}`,
        plazo: plazoSesion(p.fecha),
        det: {
          tipo: `Dato faltante · ${p.codigo}`,
          titulo: rut ? 'Falta el RUT' : 'Falta el adulto responsable',
          datos: [
            ['Falta', rut ? 'RUT' : 'Adulto responsable'],
            ['Próxima sesión', proxima(p.fecha)],
            ['Bloquea', rut ? 'La primera evolución' : 'Confirmar sus horas'],
          ],
          acciones: (
            <ButtonLink href={`/admin/fichas/${p.paciente_id}${rut ? '' : '?vista=datos'}`} variant="team" className="!px-4 !py-2.5 !text-[13px]">
              Completar datos
            </ButtonLink>
          ),
          regla: 'Los datos administrativos sí los puede editar la administración.',
        },
      });
    }
    if (admin) {
      for (const d of activas) {
        const ofrecida = d.candidatos.find((c) => c.estado === 'OFRECIDA');
        const origen = d.profesionalOrigenId === m.id;
        if (!origen && ofrecida?.profesionalId !== m.id) continue;
        const code = (d.pacienteId && codigo.get(d.pacienteId)) || 'Ficha';
        const info = bandeja.data?.find((b) => b.derivacionId === d.id);
        const candidatos = [...d.candidatos].sort((a, b) => a.orden - b.orden);
        items.push({
          key: `der-${d.id}`,
          grupo: 'der',
          code,
          titulo: origen ? 'Derivación enviada' : 'Derivación recibida',
          detalle: origen
            ? `${d.motivo} · ${ofrecida ? `ofrecida a ${nombre.get(ofrecida.profesionalId) ?? 'un profesional'}` : 'sin candidato'}`
            : `${info ? `${info.tipoAtencion} · ${info.edadPaciente} años · ` : ''}${d.motivo}`,
          plazo: ofrecida ? { texto: `Responde en ${horasHasta(ofrecida.venceEn)} h`, tono: 'pronto' } : { texto: 'Sin asignar', tono: 'vencido' },
          det: {
            tipo: `Derivación · ${code}`,
            titulo: origen ? 'Derivación enviada' : 'Derivación recibida',
            datos: [
              ['Motivo', d.motivo],
              ...(info ? ([['Edad y tipo', `${info.edadPaciente} años · ${info.tipoAtencion}`]] as [string, string][]) : []),
              ['Origen', nombre.get(d.profesionalOrigenId) ?? 'Profesional'],
            ],
            lista: {
              titulo: 'Candidatos en orden',
              filas: candidatos.map((c, i) => ({
                n: String(i + 1),
                l: nombre.get(c.profesionalId) ?? 'Profesional',
                e: c.estado === 'OFRECIDA' ? `Ofrecida · responde en ${horasHasta(c.venceEn)} h` : ESTADO_CANDIDATO_CORTO[c.estado],
                actual: c.estado === 'OFRECIDA',
              })),
            },
            acciones: (
              <ButtonLink href="/admin/fichas?vista=derivaciones" variant="team" className="!px-4 !py-2.5 !text-[13px]">
                Reordenar o reasignar
              </ButtonLink>
            ),
            regla: 'Los candidatos solo ven motivo, edad y tipo de atención antes de aceptar.',
          },
        });
      }
      for (const a of vigentes) {
        const receptor = a.profesionalId === m.id;
        if (!receptor && tratanteDe.get(a.pacienteId) !== m.id) continue;
        const code = codigo.get(a.pacienteId) ?? 'Ficha';
        const alcance = `${MOTIVO_ACCESO[a.motivo]} · ${ALCANCE_ACCESO[a.alcance].toLowerCase()}`;
        items.push({
          key: `acc-${a.id}-${m.id}`,
          grupo: 'acc',
          code,
          titulo: receptor ? 'Tiene un acceso temporal' : 'Acceso temporal otorgado',
          detalle: receptor
            ? `${alcance} · paciente de ${nombre.get(tratanteDe.get(a.pacienteId) ?? '') ?? 'otro profesional'}`
            : `${nombre.get(a.profesionalId) ?? 'Profesional'} · ${alcance}`,
          plazo: { texto: `Hasta ${formatoFechaCorta(a.hasta)}`, tono: 'plazo' },
          det: {
            tipo: `Acceso temporal · ${code}`,
            titulo: receptor ? 'Tiene un acceso temporal' : 'Acceso temporal otorgado',
            datos: [
              ['Quién accede', nombre.get(a.profesionalId) ?? 'Profesional'],
              ['Alcance', alcance],
              ['Periodo', `${formatoFechaCorta(a.desde)} al ${formatoFechaCorta(a.hasta)}`],
            ],
            acciones: (
              <ButtonLink href="/admin/fichas?vista=accesos" variant="team" className="!px-4 !py-2.5 !text-[13px]">
                Revocar acceso
              </ButtonLink>
            ),
            regla: 'El acceso no cambia al tratante, avisa al paciente y queda en la auditoría.',
          },
        });
      }
    }
    const practica = (practicanteId: string, supervisorId: string, key: string, titulo: string) => {
      const aceptados = (consentimientos.data ?? []).filter((c) => c.practicanteId === practicanteId && c.estado === 'ACEPTADO').length;
      const fin = termino.get(practicanteId);
      items.push({
        key,
        grupo: 'prac',
        code: nombre.get(practicanteId) ?? 'Practicante',
        titulo,
        detalle: `${aceptados === 1 ? '1 paciente' : `${aceptados} pacientes`} con consentimiento vigente${fin ? ` · termina el ${formatoFechaCorta(fin)}` : ''}`,
        plazo: { texto: 'Al día', tono: 'ok' },
        det: {
          tipo: 'Práctica supervisada',
          titulo: nombre.get(practicanteId) ?? 'Practicante',
          datos: [
            ['Supervisa', nombre.get(supervisorId) ?? 'Profesional'],
            ['Término', fin ? formatoFechaCorta(fin) : 'Sin fecha'],
            ['Pacientes', `${aceptados} con consentimiento vigente`],
          ],
          acciones: (
            <>
              <ButtonLink href="/admin/fichas?vista=practicas" variant="team" className="!px-4 !py-2.5 !text-[13px]">
                Ver consentimientos
              </ButtonLink>
              <ButtonLink href="/admin/equipo?vista=practicantes" variant="secondary" className="!px-4 !py-2.5 !text-[13px]">
                Cambiar supervisor o extender
              </ButtonLink>
            </>
          ),
          regla: 'Cambiar el supervisor no mueve las sesiones; el paciente recibe un aviso y puede oponerse dentro del plazo.',
        },
      });
    };
    for (const s of supervisionesVigentes) {
      if (s.supervisorId === m.id) practica(s.practicanteId, s.supervisorId, `prac-${s.id}`, 'Supervisa a un practicante');
      if (s.practicanteId === m.id) practica(s.practicanteId, s.supervisorId, `prac-${s.id}-p`, 'Práctica en curso');
    }
    return items;
  };

  const todos = miembros.map((m) => ({ m, items: itemsDe(m) }));
  const carga = (id: string) => (pacientes.data ?? []).filter((p) => p.profesionalId === id).length;
  const hoyDe = (id: string) =>
    (citasHoy.data ?? []).filter((c) => c.profesionalId === id && (c.estado === 'CONFIRMADA' || c.estado === 'PENDIENTE_PAGO')).length;
  const alDia = (id: string) => {
    const total = carga(id);
    const sinCerrar = new Set(pend.filter((p) => p.profesional_id === id && p.tipo === 'SIN_EVOLUCION').map((p) => p.paciente_id)).size;
    return total ? `${Math.round(((total - sinCerrar) / total) * 100)}%` : '—';
  };
  const practicante = (m: MiembroDirectorio) => m.roles.includes('PRACTICANTE') && !m.roles.includes('PROFESIONAL');
  // Primero quien tiene pendientes, despues por carga; los practicantes al final.
  const lista = [...todos].sort(
    (a, b) => Number(practicante(a.m)) - Number(practicante(b.m)) || b.items.length - a.items.length || carga(b.m.id) - carga(a.m.id),
  );
  const actual = lista.find((x) => x.m.id === elegido) ?? lista[0];
  const visibles = (actual?.items ?? []).filter((i) => !foco || i.grupo === foco || (foco === 'der' && i.grupo === 'acc'));
  const item = visibles.find((i) => i.key === itemElegido) ?? visibles[0];

  // Tarjetas "Requiere atencion en el centro".
  const sc = pend.filter((p) => p.tipo === 'SIN_EVOLUCION');
  const masAntigua = [...sc].sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''))[0];
  const con = pend.filter((p) => p.tipo === 'CONSENTIMIENTO');
  const dat = pend.filter((p) => p.tipo === 'SIN_RUT' || p.tipo === 'SIN_RESPONSABLE');
  const profesConSc = new Set(sc.map((p) => p.profesional_id)).size;
  const primeraOferta = activas
    .flatMap((d) => d.candidatos.filter((c) => c.estado === 'OFRECIDA'))
    .sort((a, b) => (a.venceEn ?? '').localeCompare(b.venceEn ?? ''))[0];
  const focos: { g: Grupo; n: number; titulo: string; detalle: string; color: string }[] = [
    {
      g: 'sc',
      n: sc.length,
      titulo: 'Sesiones sin cerrar',
      detalle: sc.length
        ? `En ${profesConSc} ${profesConSc === 1 ? 'profesional' : 'profesionales'} · la más antigua del ${formatoFechaCorta(masAntigua!.fecha!)}`
        : 'Todas las fichas al día',
      color: 'text-accent-800',
    },
    {
      g: 'con',
      n: con.length,
      titulo: 'Consentimientos',
      detalle: con.length ? `${con.filter((c) => c.menor).length} de menores, con adulto responsable` : 'Todos vigentes',
      color: 'text-pendiente-900',
    },
    admin
      ? {
          g: 'der',
          n: activas.length + vigentes.length,
          titulo: 'Derivaciones y accesos',
          detalle: primeraOferta ? `Una derivación responde en ${horasHasta(primeraOferta.venceEn)} h` : `${vigentes.length} accesos temporales vigentes`,
          color: 'text-text',
        }
      : { g: 'dat', n: dat.length, titulo: 'Datos administrativos', detalle: 'RUT o adulto responsable por completar', color: 'text-pendiente-900' },
    {
      g: 'prac',
      n: supervisionesVigentes.length,
      titulo: 'Prácticas',
      detalle: supervisionesVigentes.length
        ? supervisionesVigentes
            .map(
              (s) =>
                `${nombre.get(s.practicanteId) ?? 'Practicante'}${termino.get(s.practicanteId) ? `, termina el ${formatoFechaCorta(termino.get(s.practicanteId)!)}` : ''}`,
            )
            .join(' · ')
        : 'Sin prácticas en curso',
      color: 'text-accent-2-800',
    },
  ];
  const tiene = (items: Item[], g: Grupo) => items.some((i) => i.grupo === g || (g === 'der' && i.grupo === 'acc'));
  const nPracticantes = miembros.filter(practicante).length;

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="t-atencion" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <h2 id="t-atencion" className="m-0 text-[18px] font-black tracking-[-0.02em]">
            Requiere atención en el centro
          </h2>
          <span className="text-[12.5px] font-semibold text-neutral-700">Toca una tarjeta para ver qué profesionales la tienen</span>
        </div>
        <EstadoConsulta consulta={pendientes}>
          {() => (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {focos.map((f) => {
                const on = foco === f.g;
                return (
                  <button
                    key={f.g}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setFoco(on ? null : f.g);
                      setItemElegido(undefined);
                    }}
                    className={`flex cursor-pointer flex-col gap-1.5 rounded-md p-4 text-left transition-[border-color,background-color] duration-200 ease-out ${
                      on ? 'border-2 border-accent-700 bg-accent-100' : 'border border-divider bg-neutral-100 hover:border-accent-500'
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className={`text-[30px] leading-none font-black ${f.color}`}>{f.n}</span>
                      <strong className="text-[14px]">{f.titulo}</strong>
                    </span>
                    <span className="text-[12.5px] font-semibold text-neutral-800">{f.detalle}</span>
                  </button>
                );
              })}
            </div>
          )}
        </EstadoConsulta>
      </section>

      <EstadoConsulta
        consulta={equipo}
        vacio={() => lista.length === 0}
        textoVacio="Todavía no hay profesionales en el centro"
        accionVacio={agregarProfesional}
      >
        {() => (
          <div className="flex flex-wrap items-start gap-4">
            <section
              aria-labelledby="t-equipo"
              className="flex w-full flex-col gap-1 rounded-md border border-divider bg-neutral-200 px-2.5 py-3.5 lg:max-w-[270px] lg:flex-[1_1_240px]"
            >
              <div className="flex items-baseline gap-2 px-1.5 pb-1.5">
                <h2 id="t-equipo" className="m-0 text-[16px] font-black">
                  Equipo
                </h2>
                <span className="text-[12px] font-semibold text-neutral-700">
                  {foco
                    ? `${lista.filter((x) => tiene(x.items, foco)).length} con este pendiente`
                    : `${lista.length - nPracticantes} profesionales${nPracticantes ? ` · ${nPracticantes} ${nPracticantes === 1 ? 'practicante' : 'practicantes'}` : ''}`}
                </span>
              </div>
              {lista.map(({ m, items }) => {
                const on = actual?.m.id === m.id;
                const coincide = !foco || tiene(items, foco);
                const hoy = hoyDe(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setElegido(m.id);
                      setItemElegido(undefined);
                    }}
                    className={`flex min-h-[58px] w-full cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left transition-[opacity,background-color] duration-200 ${
                      on ? 'border-2 border-accent-700 bg-neutral-100' : 'border border-transparent hover:bg-neutral-100'
                    } ${coincide ? '' : 'opacity-50'}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid size-[34px] flex-none place-items-center rounded-full text-[12px] font-black ${
                        practicante(m) ? 'bg-online-100 text-online-900' : 'bg-accent-2-200 text-accent-2-900'
                      }`}
                    >
                      {iniciales(m.nombre ?? '?')}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-extrabold">
                        {m.roles.includes('ADMIN') && <span className="sr-only">Cuenta madre: </span>}
                        {m.nombre ?? 'Sin nombre'}
                      </span>
                      <span className="text-[11.5px] font-semibold text-neutral-800">
                        {practicante(m)
                          ? `Practicante · supervisa ${nombre.get(supervisionesVigentes.find((s) => s.practicanteId === m.id)?.supervisorId ?? '') ?? 'sin asignar'}`
                          : `${carga(m.id)} pac. · ${hoy ? `${hoy} hoy` : 'sin sesiones hoy'} · al día ${alDia(m.id)}`}
                      </span>
                    </span>
                    {items.length > 0 && (
                      <span className="grid h-[22px] min-w-[22px] flex-none place-items-center rounded-full bg-accent-200 px-1 text-[11px] font-black text-accent-900">
                        <span className="sr-only">Pendientes: </span>
                        {items.length}
                      </span>
                    )}
                  </button>
                );
              })}
              {agregarProfesional && (
                <div className="mt-1.5 flex justify-center rounded-sm border border-dashed border-neutral-400 p-2.5">{agregarProfesional}</div>
              )}
            </section>

            {actual && (
              <section aria-labelledby="t-prof" className="flex min-w-0 flex-[999_1_440px] flex-col gap-3.5">
                <Profesional
                  miembro={actual.m}
                  rol={rol}
                  pacientes={carga(actual.m.id)}
                  hoy={hoyDe(actual.m.id)}
                  alDia={alDia(actual.m.id)}
                  items={actual.items}
                  pacientesLista={pacientes.data ?? []}
                />
                <div className="flex flex-col gap-3 rounded-md border border-divider bg-neutral-100 p-4">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <h3 className="m-0 text-[17px] font-black">Trabajo pendiente</h3>
                    <span className="text-[12.5px] font-semibold text-neutral-700">Toca un punto para intervenir o preguntar</span>
                  </div>
                  {visibles.length === 0 ? (
                    <p className="m-0 rounded-sm bg-accent-2-200 p-4 text-[13.5px] font-bold text-accent-2-900">
                      {foco ? 'Sin pendientes de este tipo.' : 'Sin pendientes. Fichas al día, consentimientos vigentes y sin derivaciones abiertas.'}
                    </p>
                  ) : (
                    GRUPOS.map((g) => {
                      const del = visibles.filter((i) => i.grupo === g.g);
                      if (!del.length) return null;
                      return (
                        <div key={g.g} className="flex flex-col gap-1.5">
                          <p className="m-0 flex flex-wrap items-center gap-2">
                            <span className={`text-[11px] font-extrabold tracking-[0.1em] uppercase ${g.color}`}>{g.titulo}</span>
                            {g.nota && <span className="text-[11.5px] font-semibold text-neutral-700">{g.nota}</span>}
                          </p>
                          {del.map((i) => {
                            const on = item?.key === i.key;
                            return (
                              <button
                                key={i.key}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setItemElegido(i.key)}
                                className={`flex min-h-[50px] w-full cursor-pointer flex-wrap items-center gap-3 rounded-sm px-3 py-1.5 text-left ${
                                  on ? 'border-2 border-accent-700 bg-accent-100' : 'border border-divider bg-bg hover:border-accent-500'
                                }`}
                              >
                                <span className="flex-none rounded-[8px] bg-neutral-200 px-2 py-0.5 font-mono text-[12px] font-bold text-neutral-800">
                                  {i.code}
                                </span>
                                <span className="flex min-w-[160px] flex-1 flex-col">
                                  <strong className="text-[13px]">{i.titulo}</strong>
                                  <span className="text-[12px] font-semibold text-neutral-700">{i.detalle}</span>
                                </span>
                                <span className={`flex-none rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${CHIP[i.plazo.tono]}`}>{i.plazo.texto}</span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            )}

            {actual && (
              <aside
                aria-label="Intervención"
                className="flex w-full flex-col gap-3 rounded-md border border-neutral-400 bg-bg p-[18px] shadow-lg lg:sticky lg:top-4 lg:max-w-[360px] lg:flex-[1_1_300px]"
              >
                {item ? (
                  <Intervencion key={item.key} det={item.det} para={actual.m} />
                ) : (
                  <>
                    <span className="text-[11px] font-extrabold tracking-[0.1em] text-accent-700 uppercase">Sin pendientes</span>
                    <h2 className="m-0 text-[20px] leading-tight font-black">Nada que intervenir</h2>
                    <p className="m-0 text-[13px] font-semibold text-neutral-800">
                      Fichas al día: {alDia(actual.m.id)}. Elige otro profesional o una tarjeta de arriba.
                    </p>
                    <Intervencion
                      det={{ tipo: '', titulo: '', datos: [], mensaje: { asunto: 'Coordinación', texto: '' }, acciones: null, regla: '' }}
                      para={actual.m}
                      soloMensaje
                    />
                  </>
                )}
              </aside>
            )}
          </div>
        )}
      </EstadoConsulta>
    </div>
  );
}

const ESTADO_CANDIDATO_CORTO: Record<string, string> = {
  EN_ESPERA: 'En espera',
  OFRECIDA: 'Ofrecida',
  ACEPTADA: 'Aceptó',
  RECHAZADA: 'Rechazó',
  EXPIRADA: 'No respondió a tiempo',
  OMITIDA: 'Omitido',
  RECHAZADO_POR_PACIENTE: 'El paciente no aceptó',
};

/** Ficha del profesional elegido: acciones de coordinacion y cinco indicadores (sin contenido clinico). */
function Profesional({
  miembro: m,
  rol,
  pacientes,
  hoy,
  alDia,
  items,
  pacientesLista,
}: {
  miembro: MiembroDirectorio;
  rol: Rol;
  pacientes: number;
  hoy: number;
  alDia: string;
  items: Item[];
  pacientesLista: { profesionalId: string | null; createdAt: string }[];
}) {
  const [desde] = useState(() => new Date());
  const hasta = new Date(desde.getTime() + 7 * 86_400_000);
  const bloques = useQuery({
    queryKey: ['panel', 'bloques', m.id, desde.toDateString()],
    queryFn: () =>
      datos(
        api.GET('/api/profesionales/{profesionalId}/bloques', {
          params: { path: { profesionalId: m.id }, query: { desde: desde.toISOString(), hasta: hasta.toISOString() } },
        }),
      ),
  });
  const horas = Math.round((bloques.data ?? []).reduce((s, b) => s + (new Date(b.fin).getTime() - new Date(b.inicio).getTime()) / 3_600_000, 0));
  const mes = desde.toISOString().slice(0, 7);
  const nuevos = pacientesLista.filter((p) => p.profesionalId === m.id && p.createdAt.slice(0, 7) === mes).length;
  const sinCerrar = items.filter((i) => i.grupo === 'sc').reduce((s, i) => s + Number(i.titulo.split(' ')[0]), 0);
  const vencidas = items.some((i) => i.grupo === 'sc' && i.plazo.tono === 'vencido');
  const kpis: { l: string; v: string; d: string; c: string }[] = [
    { l: 'Pacientes activos', v: String(pacientes), d: nuevos ? `${nuevos} nuevos este mes` : 'asignados', c: 'text-text' },
    { l: 'Sesiones hoy', v: String(hoy), d: 'en agenda', c: 'text-text' },
    { l: 'Box esta semana', v: `${horas} h`, d: 'apartadas', c: 'text-text' },
    { l: 'Fichas al día', v: alDia, d: 'pacientes sin sesión por cerrar', c: alDia === '100%' || alDia === '—' ? 'text-accent-2-800' : 'text-pendiente-900' },
    {
      l: 'Sin cerrar',
      v: String(sinCerrar),
      d: sinCerrar ? (vencidas ? 'con plazo vencido' : 'dentro del plazo') : 'ninguna',
      c: sinCerrar ? 'text-accent-800' : 'text-accent-2-800',
    },
  ];
  return (
    <div className="flex flex-col gap-3 rounded-md border border-divider bg-neutral-100 p-4">
      <div className="flex flex-wrap items-start gap-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={m.nombre ?? '?'} size={40} />
          <div className="min-w-0">
            <h2 id="t-prof" className="m-0 text-[22px] leading-tight font-black tracking-[-0.02em]">
              {m.nombre ?? 'Sin nombre'}
            </h2>
            <p className="m-0 text-[12.5px] font-semibold text-neutral-700">
              {m.roles.includes('ADMIN') ? 'Cuenta madre · ' : ''}
              {m.tiposAtencion.join(', ') || (m.roles.includes('PRACTICANTE') ? 'Practicante' : 'Profesional')}
              {m.email ? ` · ${m.email}` : ''}
            </p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <AgendaProfesional profesionalId={m.id} nombre={m.nombre ?? 'el profesional'} />
          {rol === 'ADMIN' || rol === 'GESTION' ? (
            <ButtonLink href={`/admin/cobros?profesional=${m.id}`} variant="secondary" icon="receipt_long" className="!px-3.5 !py-2 !text-[12.5px]">
              Liquidaciones
            </ButtonLink>
          ) : null}
        </div>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.l} className="flex flex-col gap-0.5 rounded-sm border border-divider bg-bg px-3 py-2.5">
            <dt className="text-[11px] font-extrabold text-neutral-700">{k.l}</dt>
            <dd className={`m-0 text-[22px] leading-tight font-black ${k.c}`}>{k.v}</dd>
            <dd className="m-0 text-[11.5px] font-semibold text-neutral-800">{k.d}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Reenvia el enlace del consentimiento de atencion al correo registrado (D-3). */
function EnviarEnlace({ pacienteId }: { pacienteId: string }) {
  const enviar = useMutation({
    mutationFn: () => datos(api.POST('/api/pacientes/{id}/consentimiento-atencion/enlace', { params: { path: { id: pacienteId } } })),
  });
  if (enviar.isSuccess) {
    return (
      <p role="status" className="m-0 flex w-full items-center gap-1.5 text-[13px] font-bold text-accent-2-800">
        <Icon name="check_circle" size={17} />
        Enlace enviado. Vence el {formatoFechaCorta(enviar.data.venceEn)}.
      </p>
    );
  }
  return (
    <>
      <Button variant="team" loading={enviar.isPending} onClick={() => enviar.mutate()} className="!px-4 !py-2.5 !text-[13px]">
        Reenviar enlace
      </Button>
      {enviar.error && (
        <p role="alert" className="m-0 w-full text-[12.5px] font-bold text-accent-800">
          {enviar.error instanceof ApiError ? enviar.error.message : 'No pudimos enviar el enlace.'}
        </p>
      )}
    </>
  );
}

/**
 * Panel de intervencion: datos del pendiente, mensaje interno al profesional
 * (hilo GENERAL de Mensajeria interna, solo con el codigo de la ficha) y las
 * acciones que la administracion si puede hacer.
 */
function Intervencion({ det, para, soloMensaje = false }: { det: Detalle; para: MiembroDirectorio; soloMensaje?: boolean }) {
  const [texto, setTexto] = useState(det.mensaje?.texto ?? '');
  const enviar = useMutation({
    mutationFn: async () => {
      const hilo = await datos(api.POST('/api/hilos', { body: { tipo: 'GENERAL', asunto: det.mensaje!.asunto, participantes: [para.id] } }));
      await datos(api.POST('/api/hilos/{id}/mensajes', { params: { path: { id: hilo.id } }, body: { contenido: texto.trim() } }));
      return hilo.id;
    },
  });
  const nombre = para.nombre ?? 'el profesional';
  return (
    <>
      {!soloMensaje && (
        <>
          <span className="text-[11px] font-extrabold tracking-[0.1em] text-accent-700 uppercase">{det.tipo}</span>
          <h2 className="m-0 text-[20px] leading-tight font-black">{det.titulo}</h2>
          <dl className="m-0 flex flex-col gap-1.5 rounded-sm bg-neutral-200 p-3">
            {det.datos.map(([l, v]) => (
              <div key={l} className="flex justify-between gap-2.5 text-[13px]">
                <dt className="font-semibold text-neutral-700">{l}</dt>
                <dd className="m-0 text-right font-extrabold">{v}</dd>
              </div>
            ))}
          </dl>
          {det.lista && (
            <div className="flex flex-col gap-1.5">
              <p className="m-0 text-[11px] font-extrabold tracking-[0.1em] text-neutral-700 uppercase">{det.lista.titulo}</p>
              <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                {det.lista.filas.map((c) => (
                  <li
                    key={c.n}
                    className={`flex items-center gap-2.5 rounded-[10px] border border-divider px-2.5 py-2 ${c.actual ? 'bg-accent-100' : 'bg-bg'}`}
                  >
                    <span aria-hidden="true" className="grid size-[22px] place-items-center rounded-full bg-text text-[11px] font-black text-neutral-100">
                      {c.n}
                    </span>
                    <span className="flex flex-1 flex-col">
                      <strong className="text-[13px]">{c.l}</strong>
                      <span className="text-[11.5px] font-semibold text-neutral-700">{c.e}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
      {det.mensaje &&
        (enviar.isSuccess ? (
          <p role="status" className="m-0 flex flex-wrap items-center gap-1.5 rounded-sm bg-accent-2-200 p-3 text-[13px] font-bold text-accent-2-900">
            <Icon name="check_circle" size={17} />
            Mensaje enviado a {nombre}.
            <Link href={`/admin/mensajes?hilo=${enviar.data}`} className="font-extrabold">
              Ver conversación
            </Link>
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mensaje-intervencion" className="text-[12.5px] font-extrabold">
              Mensaje interno a {nombre}
            </label>
            <Textarea
              id="mensaje-intervencion"
              rows={soloMensaje ? 4 : 5}
              maxLength={4000}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={soloMensaje ? 'Escribe sin nombrar pacientes: usa el código de la ficha.' : undefined}
              className="!min-h-24 !text-[13px]"
            />
            <span className="text-[11.5px] font-semibold text-neutral-700">
              Va por Mensajería interna con el código de la ficha, nunca con el nombre del paciente.
            </span>
            {enviar.error && (
              <p role="alert" className="m-0 text-[12.5px] font-bold text-accent-800">
                {enviar.error instanceof ApiError ? enviar.error.message : 'No pudimos enviar el mensaje.'}
              </p>
            )}
          </div>
        ))}
      <div className="flex flex-wrap gap-2">
        {det.mensaje && !enviar.isSuccess && (
          <Button
            variant={det.acciones ? 'secondary' : 'team'}
            icon="send"
            loading={enviar.isPending}
            disabled={!texto.trim()}
            onClick={() => enviar.mutate()}
            className="!px-4 !py-2.5 !text-[13px]"
          >
            {soloMensaje ? 'Escribirle' : 'Enviar pregunta'}
          </Button>
        )}
        {det.acciones}
      </div>
      {det.regla && <p className="m-0 border-t border-divider pt-2 text-[12px] font-semibold text-neutral-700">{det.regla}</p>}
    </>
  );
}
