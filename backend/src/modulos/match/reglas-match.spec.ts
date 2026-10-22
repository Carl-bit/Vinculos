import { evaluar, opcionesElegidas, ordenar, type PerfilParaMatch, type PreguntaMatch, tramoPrecio, validarRespuestas } from './reglas-match';

const preguntas: PreguntaMatch[] = [
  {
    clave: 'quien',
    texto: '¿Para quién?',
    tipo: 'UNICA',
    obligatoria: true,
    max_selecciones: 1,
    opciones: [{ valor: 'adolescente', etiqueta: 'Adolescente', criterio: 'TIPO_ATENCION', objetivo: 'Adolescentes', peso: 5, estricto: true, mensaje: null }],
  },
  {
    clave: 'motivos',
    texto: '¿Qué te trae?',
    tipo: 'MULTIPLE',
    obligatoria: true,
    max_selecciones: null,
    opciones: [{ valor: 'ansiedad', etiqueta: 'Ansiedad', criterio: 'ENFOQUE', objetivo: 'ansiedad', peso: 3, estricto: false, mensaje: null }],
  },
  {
    clave: 'prevision',
    texto: 'Previsión',
    tipo: 'UNICA',
    obligatoria: true,
    max_selecciones: 1,
    opciones: [{ valor: 'fonasa', etiqueta: 'FONASA', criterio: 'PREVISION', objetivo: 'FONASA', peso: 3, estricto: true, mensaje: null }],
  },
  { clave: 'relato', texto: 'Relato', tipo: 'TEXTO', obligatoria: true, max_selecciones: null, opciones: [] },
];

const perfil = (id: string, extra: Partial<PerfilParaMatch>): PerfilParaMatch => ({
  id,
  nombre_publico: id,
  especialidad: 'Psicologia',
  enfoques: [],
  modalidad: 'MIXTA',
  tipos_atencion: [],
  boleta_reembolsable: false,
  convenios: [],
  ...extra,
});

describe('match por reglas', () => {
  const respuestas = { quien: 'adolescente', motivos: ['ansiedad'], prevision: 'fonasa', relato: 'Duermo mal hace meses' };

  it('valida obligatorias, opciones y largo del texto', () => {
    expect(validarRespuestas(preguntas, respuestas)).toEqual([]);
    expect(validarRespuestas(preguntas, { ...respuestas, relato: 'corto', otra: 'x' })).toEqual([
      'relato: entre 10 y 4000 caracteres',
      'otra: pregunta inexistente o inactiva',
    ]);
  });

  it('suma pesos, explica razones y advierte lo estricto que no cumple', () => {
    const elegidas = opcionesElegidas(preguntas, respuestas);
    const [a, b] = evaluar(
      [
        perfil('a', { tipos_atencion: ['Adolescentes'], enfoques: ['Ansiedad'], convenios: ['FONASA'] }),
        perfil('b', { tipos_atencion: ['Adolescentes'], enfoques: ['Ánsiedad'] }),
      ],
      elegidas,
    );
    expect(a).toEqual({ perfilId: 'a', puntaje: 11, razones: ['atiende adolescentes', 'trabaja ansiedad', 'tiene convenio FONASA'], incumple: [] });
    expect(b.incumple).toEqual(['FONASA']);
    const orden = ordenar([
      { ...b, primerHueco: new Date(1) },
      { ...a, primerHueco: null },
    ]);
    expect(orden.map((x) => x.perfilId)).toEqual(['a', 'b']);
  });

  it('03b-4.1: tramos de precio segun los topes configurados; dentro de cada tramo se mantiene el orden', () => {
    const topes = [25000, 35000, 45000, 60000];
    expect(tramoPrecio(30000, 35000, topes)).toEqual({ indice: 0, titulo: 'Dentro de tu preferencia' });
    expect(tramoPrecio(35000, 35000, topes).indice).toBe(0);
    expect(tramoPrecio(40000, 35000, topes)).toEqual({ indice: 1, titulo: 'Hasta $10.000 más que tu preferencia' });
    expect(tramoPrecio(50000, 35000, topes)).toEqual({ indice: 2, titulo: 'Hasta $25.000 más que tu preferencia' });
    expect(tramoPrecio(70000, 35000, topes)).toEqual({ indice: 3, titulo: 'Más de $25.000 sobre tu preferencia' });
    expect(tramoPrecio(70000, 60000, topes)).toEqual({ indice: 1, titulo: 'Sobre tu preferencia' });
    expect(tramoPrecio(null, 35000, topes).indice).toBe(Number.MAX_SAFE_INTEGER);
    // El orden por tramo es estable: conserva el orden por necesidad y disponibilidad.
    const evals = [
      { perfilId: 'caro-mejor', puntaje: 9, razones: [], incumple: [], primerHueco: null, tramo: tramoPrecio(50000, 35000, topes) },
      { perfilId: 'barato-peor', puntaje: 1, razones: [], incumple: [], primerHueco: null, tramo: tramoPrecio(30000, 35000, topes) },
      { perfilId: 'barato-mejor', puntaje: 5, razones: [], incumple: [], primerHueco: null, tramo: tramoPrecio(20000, 35000, topes) },
    ];
    expect(
      ordenar(evals)
        .sort((a, b) => a.tramo.indice - b.tramo.indice)
        .map((e) => e.perfilId),
    ).toEqual(['barato-mejor', 'barato-peor', 'caro-mejor']);
  });
});
