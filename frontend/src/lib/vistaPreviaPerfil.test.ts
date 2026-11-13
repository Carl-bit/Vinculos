import { describe, expect, it } from 'vitest';

import { tarifasVigentes, vistaPreviaPerfil, type DatosVistaPrevia } from './vistaPreviaPerfil';

const ahora = new Date('2026-11-05T12:00:00Z').getTime();
const tarifa = (id: string, monto: number, vigenteDesde: string, modalidad: 'ONLINE' | null = null) => ({
  id,
  profesionalId: 'p1',
  tipoAtencionId: null,
  modalidad,
  monto,
  vigenteDesde,
  createdAt: vigenteDesde,
});
const titulo = (anio: number, verificado: boolean) => ({
  id: `t${anio}`,
  profesionalId: 'p1',
  tipo: 'TITULO' as const,
  titulo: `Título ${anio}`,
  institucion: 'U',
  anio,
  verificado,
  registroSuperintendencia: null,
  documentoRespaldoUrl: null,
  verificadoPorId: null,
  verificadoEn: null,
  createdAt: '',
  updatedAt: '',
  respaldos: [],
  observacion: null,
  observadaEn: null,
  observadaPorId: null,
});

const base: DatosVistaPrevia = {
  perfil: {
    usuarioId: 'p1',
    nombrePublico: null,
    especialidad: 'Psicología',
    modalidad: 'MIXTA',
    bio: null,
    citaDestacada: null,
    fotoUrl: null,
    enfoques: [],
    idiomas: [],
    convenios: [],
    perfilPublico: false,
    cobroDirecto: false,
    boletaReembolsable: false,
    margenTrasladoMin: null,
    perfilPublicoConsentidoEn: null,
    createdAt: '',
    updatedAt: '',
  },
  nombreCuenta: 'Profesional Uno',
  trayectoria: [titulo(2015, true), titulo(2010, false)],
  registro: { estado: 'PENDIENTE', numero: '123', metodo: null, tituloHabilitante: null, institucion: null, verificadoEn: null, verificacionSimulada: false },
  tarifas: [tarifa('a', 30000, '2026-01-01T00:00:00Z'), tarifa('b', 35000, '2026-10-01T00:00:00Z'), tarifa('c', 40000, '2026-12-01T00:00:00Z')],
  tipos: [],
  nombreTipo: new Map(),
  resenas: [],
  ahora,
  anioActual: 2026,
};

describe('vista previa del perfil publico', () => {
  it('tarifa vigente por combinacion: la ultima ya iniciada, nunca una futura', () => {
    expect(tarifasVigentes(base.tarifas, ahora).map((t) => t.monto)).toEqual([35000]);
  });

  it('publica solo lo verificado y usa el nombre de la cuenta si no hay nombre publico', () => {
    const v = vistaPreviaPerfil(base);
    expect(v.nombre_publico).toBe('Profesional Uno');
    expect(v.trayectoria.map((t) => t.anio)).toEqual([2015]);
    expect(v.anios_experiencia).toBe(11);
    expect(v.registro_sis).toBeNull();
    const verificado = vistaPreviaPerfil({ ...base, registro: { ...base.registro!, estado: 'VERIFICADO_MANUAL', verificadoEn: '2026-10-01T00:00:00Z' } });
    expect(verificado.registro_sis?.numero).toBe('123');
  });
  it('tipos de atencion: sin nombre en el catalogo (aun cargando o inactivo) no se muestran', () => {
    const tipo = (id: string) =>
      ({
        estado: 'APROBADO',
        revisadoPorId: null,
        revisadoEn: null,
        profesionalId: 'p',
        tipoAtencionId: id,
        createdAt: '',
      }) as DatosVistaPrevia['tipos'][number];
    const v = vistaPreviaPerfil({ ...base, tipos: [tipo('a'), tipo('b'), tipo('c')], nombreTipo: new Map([['b', 'Evaluación']]) });
    expect(v.tipos_atencion).toEqual(['Evaluación']);
  });
});
