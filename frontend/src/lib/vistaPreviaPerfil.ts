/**
 * Vista previa del perfil publico armada con los datos internos del propio
 * profesional (Mi perfil): misma forma que perfiles_publicos(), con las mismas
 * reglas de lo que se publica. Sirve aunque el perfil aun no este publicado.
 *
 * - Formacion: solo la verificada por el centro.
 * - Registro SIS: solo si esta verificado.
 * - Tarifas: la vigente de cada combinacion (tipo, modalidad).
 * - Tipos de atencion: solo los aprobados.
 * - Calificacion: promedio de las reseñas publicadas.
 */
import type { components } from './api/esquema';

type S = components['schemas'];
export type PerfilPublicoVista = S['PerfilPublico'];

export interface DatosVistaPrevia {
  perfil: S['PerfilProfesionalVista'];
  /** Nombre de la cuenta: se usa si el perfil no tiene nombre publico. */
  nombreCuenta: string;
  trayectoria: S['TrayectoriaVista'][];
  registro: S['RegistroSisVista'] | null;
  tarifas: S['TarifaVista'][];
  tipos: S['TipoAtencionProfesionalVista'][];
  nombreTipo: Map<string, string>;
  resenas: S['MiResenaRecibida'][];
  ahora: number;
  anioActual: number;
}

/** Tarifa vigente por (tipo, modalidad): la ultima cuyo inicio ya paso. */
export function tarifasVigentes(tarifas: S['TarifaVista'][], ahora: number): S['TarifaVista'][] {
  const vigente = new Map<string, S['TarifaVista']>();
  for (const t of tarifas) {
    if (new Date(t.vigenteDesde).getTime() > ahora) continue;
    const clave = `${t.tipoAtencionId ?? ''}|${t.modalidad ?? ''}`;
    const actual = vigente.get(clave);
    if (!actual || t.vigenteDesde > actual.vigenteDesde) vigente.set(clave, t);
  }
  return [...vigente.values()];
}

export function vistaPreviaPerfil(d: DatosVistaPrevia): PerfilPublicoVista {
  const verificada = d.trayectoria.filter((t) => t.verificado);
  const titulos = verificada.filter((t) => t.tipo === 'TITULO');
  const primerAnio = titulos.length ? Math.min(...titulos.map((t) => t.anio)) : null;
  const publicadas = d.resenas.filter((r) => r.estado === 'PUBLICADA');
  const promedio = publicadas.length ? publicadas.reduce((a, r) => a + r.calificacion, 0) / publicadas.length : null;
  const r = d.registro;
  const registroVerificado =
    r && r.numero && r.verificadoEn && (r.estado === 'VERIFICADO_AUTOMATICO' || r.estado === 'VERIFICADO_MANUAL')
      ? { estado: r.estado, numero: r.numero, verificado_en: r.verificadoEn }
      : null;
  return {
    id: d.perfil.usuarioId,
    nombre_publico: d.perfil.nombrePublico || d.nombreCuenta || null,
    bio: d.perfil.bio,
    foto_url: d.perfil.fotoUrl,
    modalidad: d.perfil.modalidad,
    anios_experiencia: primerAnio === null ? null : d.anioActual - primerAnio,
    cita_destacada: d.perfil.citaDestacada,
    calificacion: promedio === null ? null : promedio.toFixed(2),
    registro_sis: registroVerificado,
    especialidad: d.perfil.especialidad,
    enfoques: d.perfil.enfoques,
    tipos_atencion: d.tipos.filter((t) => t.estado === 'APROBADO').flatMap((t) => d.nombreTipo.get(t.tipoAtencionId) ?? []),
    verificado: verificada.length > 0,
    titulos_verificados: titulos.map((t) => t.titulo),
    tarifas: tarifasVigentes(d.tarifas, d.ahora).map((t) => ({
      tipo_atencion: t.tipoAtencionId ? (d.nombreTipo.get(t.tipoAtencionId) ?? null) : null,
      modalidad: t.modalidad,
      monto: t.monto,
    })),
    trayectoria: verificada.map((t) => ({ tipo: t.tipo, titulo: t.titulo, institucion: t.institucion, anio: t.anio })),
    boleta_reembolsable: d.perfil.boletaReembolsable,
    convenios: d.perfil.convenios,
    idiomas: d.perfil.idiomas,
    resenas: publicadas.length,
  };
}
