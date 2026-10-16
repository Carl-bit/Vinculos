import { type CampoPlantilla, erroresValores, valoresSupervision } from './plantillas-clinicas';

const campo = (c: Partial<CampoPlantilla> & Pick<CampoPlantilla, 'clave' | 'tipo'>): CampoPlantilla => ({
  etiqueta: c.clave,
  obligatorio: false,
  orden: 1,
  visible_en_supervision: true,
  es_texto_libre: false,
  ...c,
});

const DEF: CampoPlantilla[] = [
  campo({ clave: 'motivo', tipo: 'TEXTO_LARGO', obligatorio: true, es_texto_libre: true }),
  campo({ clave: 'peso', tipo: 'NUMERO' }),
  campo({ clave: 'control', tipo: 'FECHA' }),
  campo({ clave: 'previo', tipo: 'SI_NO', visible_en_supervision: false }),
  campo({ clave: 'red', tipo: 'SELECCION_UNICA', opciones: ['Alta', 'Baja'] }),
  campo({ clave: 'areas', tipo: 'SELECCION_MULTIPLE', opciones: ['Voz', 'Habla'] }),
];

describe('valores de plantilla clinica', () => {
  it('acepta valores validos y omite opcionales', () => {
    expect(erroresValores(DEF, { motivo: 'Ansiedad', peso: 70.5, control: '2026-11-02', previo: false, red: 'Alta', areas: ['Voz'] })).toEqual([]);
    expect(erroresValores(DEF, { motivo: 'x' })).toEqual([]);
  });

  it('rechaza obligatorio faltante, tipos, opciones y claves desconocidas', () => {
    expect(erroresValores(DEF, { peso: '70', control: '02-11-2026', previo: 'no', red: 'Media', areas: ['Voz', 'Voz'], extra: 1 })).toEqual([
      'extra: campo inexistente en esta version de la plantilla',
      'motivo: obligatorio',
      'peso: numero',
      'control: fecha AAAA-MM-DD',
      'previo: si/no (true o false)',
      'red: una de las opciones de la plantilla',
      'areas: opciones de la plantilla, sin repetir',
    ]);
    expect(erroresValores(DEF, [])).toEqual(['valores debe ser un objeto { clave: valor }']);
  });

  it('un borrador puede quedar sin obligatorios, pero no con tipos invalidos', () => {
    expect(erroresValores(DEF, { peso: 60 }, false)).toEqual([]);
    expect(erroresValores(DEF, { peso: 'x' }, false)).toEqual(['peso: numero']);
  });

  it('supervision: solo campos marcados, con los de texto libre señalados', () => {
    expect(valoresSupervision(DEF, { motivo: 'm', previo: true, peso: 1 })).toEqual({
      valores: { motivo: 'm', peso: 1 },
      camposTextoLibre: ['motivo'],
    });
  });
});
