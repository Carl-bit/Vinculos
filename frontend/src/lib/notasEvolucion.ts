/**
 * Formato de las notas de una evolucion (sin dependencias ni HTML: se guarda
 * texto y se muestra con elementos de React). La API guarda un solo texto, asi
 * que titulo, escalas y tareas viajan dentro de las notas, legibles tal cual
 * en una exportacion:
 *
 *   # Seguimiento
 *
 *   Refiere **menos** episodios de ansiedad.
 *
 *   Escala · Ánimo: 6/10
 *   Tarea · Completar autorregistro
 */
export interface EscalaNota {
  nombre: string;
  valor: number;
}

export interface PartesNotas {
  titulo: string;
  cuerpo: string;
  escalas: EscalaNota[];
  tareas: string[];
}

export type Formato = 'negrita' | 'cursiva' | 'subrayado' | 'titulo' | 'lista' | 'numerada' | 'cita';

export type BloqueTexto = { tipo: 'titulo' | 'parrafo' | 'cita'; texto: string } | { tipo: 'lista' | 'numerada'; items: string[] };

export type TrozoTexto = { texto: string; estilo?: 'negrita' | 'cursiva' | 'subrayado' };

const ESCALA = /^Escala · (.+): (\d{1,2})\/10$/;
const TAREA = /^Tarea · (.+)$/;
const MARCA_INLINE: Record<'negrita' | 'cursiva' | 'subrayado', string> = { negrita: '**', cursiva: '*', subrayado: '__' };
const PREFIJO: Record<'titulo' | 'lista' | 'cita', string> = { titulo: '## ', lista: '- ', cita: '> ' };

export function separarNotas(notas: string): PartesNotas {
  const lineas = notas.split('\n');
  const titulo = lineas[0]?.startsWith('# ') ? lineas.shift()!.slice(2).trim() : '';
  const escalas: EscalaNota[] = [];
  const tareas: string[] = [];
  const resto = lineas.filter((l) => {
    const escala = ESCALA.exec(l.trim());
    if (escala) escalas.push({ nombre: escala[1]!, valor: Number(escala[2]) });
    const tarea = TAREA.exec(l.trim());
    if (tarea) tareas.push(tarea[1]!);
    return !escala && !tarea;
  });
  return { titulo, cuerpo: resto.join('\n').trim(), escalas, tareas };
}

export function unirNotas({ titulo, cuerpo, escalas, tareas }: PartesNotas): string {
  const extras = [...escalas.map((e) => `Escala · ${e.nombre}: ${e.valor}/10`), ...tareas.map((t) => `Tarea · ${t}`)];
  return [titulo.trim() && `# ${titulo.trim()}`, cuerpo.trim(), extras.join('\n')].filter(Boolean).join('\n\n');
}

/** Envuelve la seleccion (negrita, cursiva, subrayado) o marca sus lineas (titulo, listas, cita). */
export function aplicarFormato(texto: string, inicio: number, fin: number, formato: Formato): { texto: string; inicio: number; fin: number } {
  if (formato === 'negrita' || formato === 'cursiva' || formato === 'subrayado') {
    const marca = MARCA_INLINE[formato];
    return {
      texto: `${texto.slice(0, inicio)}${marca}${texto.slice(inicio, fin)}${marca}${texto.slice(fin)}`,
      inicio: inicio + marca.length,
      fin: fin + marca.length,
    };
  }
  const desde = texto.lastIndexOf('\n', inicio - 1) + 1;
  const saltoFin = texto.indexOf('\n', fin);
  const hasta = saltoFin === -1 ? texto.length : saltoFin;
  const marcadas = texto
    .slice(desde, hasta)
    .split('\n')
    .map((l, i) => `${formato === 'numerada' ? `${i + 1}. ` : PREFIJO[formato]}${l}`)
    .join('\n');
  const nuevo = `${texto.slice(0, desde)}${marcadas}${texto.slice(hasta)}`;
  return { texto: nuevo, inicio: desde + marcadas.length, fin: desde + marcadas.length };
}

export function bloquesDeTexto(cuerpo: string): BloqueTexto[] {
  return cuerpo
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .flatMap((bloque): BloqueTexto[] => {
      const lineas = bloque.split('\n').map((l) => l.trim());
      if (lineas.every((l) => l.startsWith('- '))) return [{ tipo: 'lista', items: lineas.map((l) => l.slice(2)) }];
      if (lineas.every((l) => /^\d+\. /.test(l))) return [{ tipo: 'numerada', items: lineas.map((l) => l.replace(/^\d+\. /, '')) }];
      if (lineas.every((l) => l.startsWith('> '))) return [{ tipo: 'cita', texto: lineas.map((l) => l.slice(2)).join('\n') }];
      if (lineas[0]?.startsWith('## ')) {
        const resto = lineas.slice(1).join('\n');
        return [{ tipo: 'titulo', texto: lineas[0].slice(3) }, ...(resto ? [{ tipo: 'parrafo' as const, texto: resto }] : [])];
      }
      return [{ tipo: 'parrafo', texto: lineas.join('\n') }];
    });
}

export function trozosDeTexto(texto: string): TrozoTexto[] {
  return texto
    .split(/(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/)
    .filter(Boolean)
    .map((t) => {
      if (/^\*\*.+\*\*$/.test(t)) return { texto: t.slice(2, -2), estilo: 'negrita' };
      if (/^__.+__$/.test(t)) return { texto: t.slice(2, -2), estilo: 'subrayado' };
      if (/^\*.+\*$/.test(t)) return { texto: t.slice(1, -1), estilo: 'cursiva' };
      return { texto: t };
    });
}

/** Texto corrido, sin marcas, para extractos y resumenes. */
export function textoPlano(notas: string): string {
  return bloquesDeTexto(separarNotas(notas).cuerpo)
    .flatMap((b) => ('items' in b ? b.items : [b.texto]))
    .map((t) =>
      trozosDeTexto(t)
        .map((x) => x.texto)
        .join(''),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
