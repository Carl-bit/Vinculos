import { bloquesDeTexto, separarNotas, trozosDeTexto } from '@/lib/notasEvolucion';

const ESTILO = { negrita: 'font-extrabold', cursiva: 'italic', subrayado: 'underline' } as const;

function Texto({ texto }: { texto: string }) {
  return trozosDeTexto(texto).map((t, i) =>
    t.estilo ? (
      <span key={i} className={ESTILO[t.estilo]}>
        {t.texto}
      </span>
    ) : (
      t.texto
    ),
  );
}

/** Lectura de las notas de una evolucion (lib/notasEvolucion): sin titulo, que lo pone quien la muestra. */
export function NotasClinicas({ notas }: { notas: string }) {
  const { cuerpo, escalas, tareas } = separarNotas(notas);
  return (
    <div className="flex flex-col gap-3 text-[16px] leading-[1.75] font-medium text-pretty">
      {bloquesDeTexto(cuerpo).map((b, i) => {
        if (b.tipo === 'titulo') {
          return (
            <p key={i} className="m-0 text-[17px] font-black">
              <Texto texto={b.texto} />
            </p>
          );
        }
        if ('items' in b) {
          const Lista = b.tipo === 'lista' ? 'ul' : 'ol';
          return (
            <Lista key={i} className={`m-0 pl-6 ${b.tipo === 'lista' ? 'list-disc' : 'list-decimal'}`}>
              {b.items.map((item, j) => (
                <li key={j}>
                  <Texto texto={item} />
                </li>
              ))}
            </Lista>
          );
        }
        return (
          <p key={i} className={`m-0 whitespace-pre-line ${b.tipo === 'cita' ? 'border-l-[3px] border-accent-500 pl-3.5 text-neutral-800 italic' : ''}`}>
            <Texto texto={b.texto} />
          </p>
        );
      })}
      {escalas.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {escalas.map((e) => (
            <li key={e.nombre} className="flex items-center gap-3 text-[14px] font-bold">
              <span className="min-w-0 flex-1">{e.nombre}</span>
              <span aria-hidden="true" className="h-2 w-32 overflow-hidden rounded-full bg-neutral-300">
                <span className="block h-full rounded-full bg-accent-700" style={{ width: `${e.valor * 10}%` }} />
              </span>
              <span className="tabular-nums">{e.valor}/10</span>
            </li>
          ))}
        </ul>
      )}
      {tareas.length > 0 && (
        <div>
          <p className="m-0 text-xs font-extrabold text-neutral-700">Tareas acordadas</p>
          <ul className="m-0 list-disc pl-6 text-[14.5px] font-semibold">
            {tareas.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
