import { describe, expect, it } from 'vitest';

import { alertasPerfil, checksIntegrante, estadoIntegrante, type DatosValidacion } from './validacionEquipo';

const ahora = new Date('2026-11-05T12:00:00Z').getTime();
const titulo = (verificado: boolean) =>
  ({ id: 't', tipo: 'TITULO', titulo: 'Psicólogo', institucion: 'U. Ficticia', anio: 2015, verificado, respaldos: [] }) as unknown as NonNullable<
    DatosValidacion['trayectoria']
  >[number];
const profesional: DatosValidacion = {
  roles: ['PROFESIONAL'],
  activo: true,
  registro: { estado: 'VERIFICADO_MANUAL', numero: '100001' } as DatosValidacion['registro'],
  trayectoria: [titulo(true)],
  tipos: [{ estado: 'APROBADO' }] as DatosValidacion['tipos'],
  especialidades: [],
  ahora,
};

describe('validacion del equipo', () => {
  it('profesional: habilitado con RNPI, titulo verificado y nada por revisar', () => {
    const c = checksIntegrante(profesional)!;
    expect(c.map((x) => x.ok)).toEqual([true, true, true]);
    expect(estadoIntegrante(profesional, c)).toBe('HABILITADO');
  });

  it('profesional: por validar si falta el RNPI, el titulo o hay tipos propuestos; sin datos aun, undefined', () => {
    const d = {
      ...profesional,
      registro: { estado: 'PENDIENTE', numero: '1' } as DatosValidacion['registro'],
      tipos: [{ estado: 'PROPUESTO' }] as DatosValidacion['tipos'],
    };
    const c = checksIntegrante(d)!;
    expect(c.filter((x) => !x.ok).map((x) => x.clave)).toEqual(['sis', 'tipos']);
    expect(estadoIntegrante(d, c)).toBe('POR_VALIDAR');
    // Solo tipos por revisar: pendiente, no bloquea (sigue en el sitio).
    const soloTipos = { ...profesional, tipos: [{ estado: 'PROPUESTO' }] as DatosValidacion['tipos'] };
    expect(estadoIntegrante(soloTipos, checksIntegrante(soloTipos))).toBe('HABILITADO');
    expect(checksIntegrante({ ...profesional, trayectoria: [titulo(false)] })![1]!.ok).toBe(false);
    expect(checksIntegrante({ ...profesional, registro: undefined })).toBeUndefined();
  });

  it('practicante: vencido cuando el acceso termino; sin dato de acceso (GESTION) no se evalua', () => {
    const base: DatosValidacion = {
      roles: ['PRACTICANTE'],
      activo: true,
      supervisor: 'Profesional Dos',
      practica: { inicio: '2026-10-07', termino: '2027-04-21' },
      accesoHasta: '2026-10-30T00:00:00Z',
      ahora,
    };
    expect(estadoIntegrante(base, checksIntegrante(base))).toBe('VENCIDO');
    // Fecha de calendario sin correrse por la zona horaria (2026-10-07 no es el 6).
    expect(checksIntegrante(base)![1]!.detalle).toBe('Del 7 oct 2026 al 21 abr 2027');
    const vigente = { ...base, accesoHasta: '2027-02-02T00:00:00Z' };
    expect(estadoIntegrante(vigente, checksIntegrante(vigente))).toBe('HABILITADO');
    expect(checksIntegrante({ ...base, accesoHasta: undefined })!.map((c) => c.clave)).toEqual(['supervisor', 'practica']);
    // Documentos de la practica: informativos.
    const conDocs = { ...vigente, documentos: ['CERTIFICADO_ALUMNO_REGULAR'] };
    const docs = checksIntegrante(conDocs)!;
    expect(docs.at(-1)).toEqual(expect.objectContaining({ clave: 'documentos', ok: false, detalle: 'Falta: convenio de práctica' }));
    expect(estadoIntegrante(conDocs, docs)).toBe('HABILITADO');
    const sinSupervisor = { ...vigente, supervisor: null };
    expect(estadoIntegrante(sinSupervisor, checksIntegrante(sinSupervisor))).toBe('POR_VALIDAR');
  });

  it('gestion no requiere validacion; inactiva y baja ganan', () => {
    const gestion: DatosValidacion = { roles: ['GESTION'], activo: true, ahora };
    expect(estadoIntegrante(gestion, checksIntegrante(gestion))).toBe('NO_REQUIERE');
    expect(estadoIntegrante({ ...gestion, activo: false }, [])).toBe('INACTIVA');
    expect(estadoIntegrante({ ...profesional, bajaEn: '2026-11-30' }, checksIntegrante(profesional))).toBe('BAJA');
  });

  it('alertas del perfil: dato de contacto, texto corto, sin frase, sin enfoques, sin foto', () => {
    expect(alertasPerfil({ bio: 'Escríbeme al +56 9 1234 5678 para coordinar.', citaDestacada: null, enfoques: [], fotoUrl: null })).toEqual([
      'El texto incluye un dato de contacto personal',
      '"Sobre mí" muy corto: menos de 3 líneas',
      'Sin frase destacada',
      'Sin enfoques declarados',
      'Sin foto',
    ]);
    expect(alertasPerfil({ bio: 'x'.repeat(200), citaDestacada: 'Acompañar sin apuro.', enfoques: ['Sistémico'], fotoUrl: '/f.jpg' })).toEqual([]);
  });
});
