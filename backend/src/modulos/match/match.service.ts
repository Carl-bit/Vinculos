import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Modalidad, ModalidadAtencion, TipoPolitica } from '@prisma/client';

import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { LlaveroService } from '../../core/crypto/llavero.service';
import type { FiltroPerfilesDto, MatchDto } from './dto/match.dto';
import { evaluar, opcionesElegidas, ordenar, type PreguntaMatch, type Respuestas, validarRespuestas } from './reglas-match';

export interface TarifaPublica {
  tipo_atencion: string | null;
  modalidad: ModalidadAtencion | null;
  monto: number;
}

export interface PerfilPublico {
  id: string;
  nombre_publico: string | null;
  bio: string | null;
  foto_url: string | null;
  especialidad: string;
  enfoques: string[];
  modalidad: Modalidad;
  tipos_atencion: string[];
  verificado: boolean;
  titulos_verificados: string[];
  tarifas: TarifaPublica[];
  trayectoria: { tipo: string; titulo: string; institucion: string; anio: number }[];
  anios_experiencia: number | null;
  boleta_reembolsable: boolean;
  convenios: string[];
  idiomas: string[];
  cita_destacada: string | null;
  calificacion: string | null;
  resenas: number;
}

export interface Hueco {
  modalidad: ModalidadAtencion;
  inicio: Date;
  fin: Date;
}

const DIA = 86_400_000;
const ZONA = 'America/Santiago';

/** Dia ISO (1-7) y minuto local de un instante en Chile. */
function diaYMinuto(fecha: Date): { dia: number; minuto: number } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(fecha);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const dia = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(v('weekday')) + 1;
  return { dia, minuto: Number(v('hour')) * 60 + Number(v('minute')) };
}

/**
 * Portal publico (sin autenticacion, sin contexto RLS: funciones diseñadas
 * para eso) y Match terapeutico. Nunca RUT, datos bancarios ni contacto.
 */
@Injectable()
export class MatchService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  private get db() {
    return this.bd.sinContexto('publico');
  }

  /** Perfiles publicos (solo PROFESIONAL; nunca practicantes, C-3). Filtros del equipo publico. */
  async perfiles(filtro: FiltroPerfilesDto = {}): Promise<PerfilPublico[]> {
    const todos = await this.db.$queryRaw<PerfilPublico[]>`SELECT * FROM perfiles_publicos()`;
    return todos.filter(
      (p) =>
        (!filtro.tipoAtencion || p.tipos_atencion.includes(filtro.tipoAtencion)) &&
        (!filtro.modalidad || p.modalidad === 'MIXTA' || p.modalidad === filtro.modalidad),
    );
  }

  /** Sin contexto solo responde para perfiles publicos (la funcion lo filtra). Max. 62 dias. */
  disponibilidad(profesionalId: string, desde: Date, hasta: Date): Promise<Hueco[]> {
    return this.db.$queryRaw<Hueco[]>`
      SELECT modalidad, inicio, fin FROM disponibilidad_publica(${profesionalId}::uuid, ${desde}, ${hasta})`;
  }

  /** Contenido de la pagina publica, nombre del centro, modulos y politica de cancelacion (para los terminos). */
  async centro() {
    const [{ c }] = await this.db.$queryRaw<[{ c: Record<string, unknown> }]>`SELECT contenido_publico_centro() AS c`;
    return c;
  }

  async politica(tipo: TipoPolitica) {
    const [p] = await this.db.$queryRaw<{ id: string; version: number; texto: string; vigente_desde: Date }[]>`
      SELECT * FROM politica_vigente(${tipo}::tipo_politica)`;
    if (!p) {
      throw new NotFoundException('Sin politica publicada');
    }
    return p;
  }

  async imagen(id: string) {
    const [i] = await this.db.$queryRaw<{ tipo_mime: string; contenido: Uint8Array }[]>`SELECT * FROM imagen_publica(${id}::uuid)`;
    if (!i) {
      throw new NotFoundException('Imagen no encontrada');
    }
    return { tipoMime: i.tipo_mime, contenido: Buffer.from(i.contenido) };
  }

  /** Reseñas publicadas (D-1): "Nombre + inicial" o "Usuario anonimo". */
  async resenas(profesionalId: string) {
    const filas = await this.db.$queryRaw<{ id: string; calificacion: number; texto: Uint8Array | null; autor: string; creada_en: Date }[]>`
      SELECT * FROM resenas_publicas(${profesionalId}::uuid)`;
    return filas.map((r) => ({
      id: r.id,
      calificacion: r.calificacion,
      texto: this.llavero.descifrarCampo(r.texto, 'resenas', 'texto', r.id),
      autor: r.autor,
      fecha: r.creada_en,
    }));
  }

  async reportarResena(id: string, motivo: string) {
    await this.db.$executeRaw`SELECT reportar_resena(${id}::uuid, ${motivo})`;
  }

  async cuestionario(): Promise<{ preguntas: PreguntaMatch[]; filtroDirecto: boolean }> {
    const [{ q }] = await this.db.$queryRaw<[{ q: PreguntaMatch[] }]>`SELECT cuestionario_match() AS q`;
    const centro = await this.centro();
    return { preguntas: q, filtroDirecto: centro.match_filtro_directo === true };
  }

  /**
   * Match por reglas (D-5) y explicable. No guarda respuestas (C-17): solo
   * cuenta el resultado anonimo (match_resultados) para las metricas.
   * Disponibilidad real: con Agenda activa, huecos de los proximos 14 dias en
   * los dias y franjas elegidos.
   */
  async calcular(respuestas: Respuestas) {
    const { preguntas } = await this.cuestionario();
    const errores = validarRespuestas(preguntas, respuestas);
    if (errores.length) {
      throw new BadRequestException({ message: errores, restriccion: 'match_respuestas_invalidas' });
    }
    const elegidas = opcionesElegidas(preguntas, respuestas);
    const valoresDe = (tipo: PreguntaMatch['tipo']) => {
      const q = preguntas.find((x) => x.tipo === tipo);
      const r = q ? respuestas[q.clave] : undefined;
      return r === undefined ? [] : [r].flat();
    };
    const dias = valoresDe('DIAS');
    const franjas = valoresDe('FRANJAS').map((f) => f.split('-').map(Number) as [number, number]);
    const modalidad = elegidas.find((o) => o.criterio === 'MODALIDAD')?.objetivo as ModalidadAtencion | undefined;
    const perfiles = await this.perfiles();
    const agenda = ((await this.centro()).modulos as string[]).includes('AGENDA');
    const desde = new Date();
    const evaluados = await Promise.all(
      evaluar(perfiles, elegidas).map(async (e) => {
        const huecos = agenda ? await this.disponibilidad(e.perfilId, desde, new Date(desde.getTime() + 14 * DIA)) : [];
        const enPreferencia = huecos.filter((h) => {
          const { dia, minuto } = diaYMinuto(h.inicio);
          return (
            (!modalidad || h.modalidad === modalidad) &&
            (dias.length === 0 || dias.includes(String(dia))) &&
            (franjas.length === 0 || franjas.some(([a, b]) => minuto >= a && minuto < b))
          );
        });
        const razones = enPreferencia.length ? [...e.razones, 'tiene horas en los dias y horarios que marcaste'] : e.razones;
        return { ...e, razones, puntaje: e.puntaje + (enPreferencia.length ? 2 : 0), primerHueco: enPreferencia[0]?.inicio ?? null };
      }),
    );
    const orden = ordenar(evaluados);
    const vista = (e: (typeof orden)[number]) => {
      const p = perfiles.find((x) => x.id === e.perfilId)!;
      return {
        perfil: p,
        puntaje: e.puntaje,
        razones: e.razones,
        advertencia: e.incumple.length ? `No cumple con: ${e.incumple.join(', ')}. Puedes agendar igual o escribirnos para revisar alternativas.` : null,
        primerHueco: e.primerHueco,
      };
    };
    const recomendado = orden[0] ? vista(orden[0]) : null;
    if (recomendado) {
      await this.db.$executeRaw`SELECT registrar_resultado_match(${recomendado.perfil.id}::uuid)`;
    }
    return {
      recomendado,
      otros: orden.slice(1, 6).map(vista),
      avisos: [...new Set(elegidas.map((o) => o.mensaje).filter((m): m is string => !!m))],
      resumen: elegidas.map((o) => o.etiqueta),
    };
  }

  /**
   * Filtro directo ("prefiero filtrar yo mismo", 02g): necesidad > tiempos >
   * precio. Tiempos y precio ordenan, no excluyen.
   */
  async match(dto: MatchDto) {
    const desde = dto.desde ?? new Date();
    const hasta = dto.hasta ?? new Date(desde.getTime() + 14 * DIA);
    const candidatos = await this.perfiles({ tipoAtencion: dto.tipoAtencion, modalidad: dto.modalidad });
    const resultados = await Promise.all(
      candidatos.map(async (p) => {
        const huecos = (await this.disponibilidad(p.id, desde, hasta)).filter((h) => !dto.modalidad || h.modalidad === dto.modalidad);
        const tarifa = tarifaAplicable(p.tarifas, dto.tipoAtencion, dto.modalidad);
        return {
          perfil: p,
          tarifa,
          primerHueco: huecos[0]?.inicio ?? null,
          cumpleTiempos: huecos.length > 0,
          cumplePrecio: dto.tarifaMaxima === undefined || (tarifa !== null && tarifa <= dto.tarifaMaxima),
        };
      }),
    );
    return resultados.sort(
      (a, b) =>
        Number(b.cumpleTiempos) - Number(a.cumpleTiempos) ||
        (a.primerHueco?.getTime() ?? Infinity) - (b.primerHueco?.getTime() ?? Infinity) ||
        Number(b.cumplePrecio) - Number(a.cumplePrecio) ||
        (a.tarifa ?? Infinity) - (b.tarifa ?? Infinity),
    );
  }
}

/** La tarifa mas especifica vigente: tipo+modalidad, tipo, modalidad, general. */
export function tarifaAplicable(tarifas: TarifaPublica[], tipo?: string, modalidad?: ModalidadAtencion): number | null {
  const buscar = (t: string | null, m: ModalidadAtencion | null) => tarifas.find((x) => x.tipo_atencion === t && x.modalidad === m)?.monto;
  return (
    (tipo && modalidad ? buscar(tipo, modalidad) : undefined) ??
    (tipo ? buscar(tipo, null) : undefined) ??
    (modalidad ? buscar(null, modalidad) : undefined) ??
    buscar(null, null) ??
    null
  );
}
