'use client';

import { useId } from 'react';

import { Icon } from '@/components/ui/Icon';
import type { components } from '@/lib/api/esquema';
import type { Icono } from '@/lib/iconos';

export type Pregunta = components['schemas']['PreguntaPublica'];
export type Respuesta = string | string[] | undefined;

/** Iconos de las opciones del cuestionario de ejemplo (por valor). Opciones nuevas del ADMIN van sin icono. */
const ICONO_OPCION: Record<string, Icono> = {
  ansiedad: 'air',
  estres: 'bolt',
  animo: 'cloud',
  duelo: 'favorite',
  sueno: 'bedtime',
  pareja: 'diversity_1',
  familia: 'family_restroom',
  trabajo: 'work',
  autoestima: 'self_improvement',
  conducta: 'child_care',
  adulto: 'person',
  adolescente: 'school',
  infantil: 'child_care',
  online: 'videocam',
  presencial: 'meeting_room',
  indistinto: 'swap_horiz',
  '480-720': 'wb_twilight',
  '720-900': 'light_mode',
  '900-1140': 'wb_sunny',
  '1140-1260': 'dark_mode',
};

export const MAX_RELATO = 2000;

/** Valores elegidos como lista (UNICA/ESCALA guardan un string). */
export const elegidos = (r: Respuesta): string[] => (r === undefined ? [] : Array.isArray(r) ? r : [r]);

export const respondida = (q: Pregunta, r: Respuesta) => (q.tipo === 'TEXTO' ? typeof r === 'string' && r.trim() !== '' : elegidos(r).length > 0);

const esMultiple = (q: Pregunta) => q.tipo === 'MULTIPLE' || ((q.tipo === 'DIAS' || q.tipo === 'FRANJAS') && q.max_selecciones !== 1);

/**
 * Una pregunta del cuestionario configurable. Las opciones son inputs reales
 * (radio o casilla) con estilo de pastilla o tarjeta: teclado y lector de
 * pantalla funcionan sin ARIA extra.
 */
export function PreguntaMatch({ pregunta: q, valor, onChange }: { pregunta: Pregunta; valor: Respuesta; onChange: (r: Respuesta) => void }) {
  const id = useId();
  const lista = elegidos(valor);
  const multiple = esMultiple(q);
  const limite = multiple ? q.max_selecciones : 1;
  const lleno = !!limite && multiple && lista.length >= limite;

  if (q.tipo === 'TEXTO') {
    const texto = typeof valor === 'string' ? valor : '';
    return (
      <div className="flex flex-col gap-3">
        <label htmlFor={`${id}-texto`} className="sr-only">
          {q.texto}
        </label>
        <textarea
          id={`${id}-texto`}
          rows={7}
          maxLength={MAX_RELATO}
          value={texto}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-cuenta ${id}-privado`}
          placeholder="Por ejemplo: hace unos meses que duermo mal y me cuesta concentrarme en el trabajo."
          className="w-full resize-y rounded-[20px] border-[1.5px] border-neutral-400 bg-neutral-100 px-5 py-[18px] text-[15.5px] leading-[1.65] font-medium placeholder:text-neutral-700 focus-visible:border-accent-500"
        />
        <span id={`${id}-cuenta`} className="self-end text-[12.5px] font-bold text-neutral-700">
          {texto.length} / {MAX_RELATO}
        </span>
        <p
          id={`${id}-privado`}
          className="m-0 flex gap-[11px] rounded-[18px] border border-divider bg-neutral-100 px-[17px] py-[15px] text-[13px] font-bold text-pretty text-neutral-700"
        >
          <Icon name="lock" size={19} />
          El match no guarda lo que escribes. Si después pides hora, viaja cifrado con tu solicitud y lo lee solo el profesional que te atienda.
        </p>
      </div>
    );
  }

  const conTarjetas = q.tipo === 'ESCALA' || q.opciones.some((o) => o.nota);
  const elegida = q.opciones.find((o) => lista.includes(o.valor));
  const cambiar = (v: string, marcada: boolean) => {
    if (!multiple) return onChange(v);
    onChange(marcada ? [...lista, v] : lista.filter((x) => x !== v));
  };

  return (
    <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
      <legend className="sr-only">{q.texto}</legend>
      <div
        className={
          q.tipo === 'ESCALA'
            ? 'grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2.5'
            : conTarjetas
              ? 'grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3'
              : 'flex flex-wrap gap-2.5'
        }
      >
        {q.opciones.map((o) => {
          const marcada = lista.includes(o.valor);
          const icono = ICONO_OPCION[o.valor];
          const bloqueada = lleno && !marcada;
          return (
            <label
              key={o.valor}
              className={`group relative flex cursor-pointer border-[1.5px] transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent active:scale-[0.98] ${
                marcada ? 'border-accent-2-600 bg-accent-2-200 text-accent-2-900 shadow-sm' : 'border-neutral-400 bg-bg text-text hover:border-accent-500'
              } ${bloqueada ? 'cursor-not-allowed opacity-50' : ''} ${
                q.tipo === 'ESCALA'
                  ? 'flex-col items-start gap-1 rounded-[18px] px-4 py-3.5'
                  : conTarjetas
                    ? 'flex-col items-start gap-3 rounded-lg px-[18px] py-5'
                    : 'items-center gap-[9px] rounded-full px-5 py-3 text-sm font-extrabold'
              }`}
            >
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={id}
                value={o.valor}
                checked={marcada}
                disabled={bloqueada}
                onChange={(e) => cambiar(o.valor, e.target.checked)}
                className="sr-only"
              />
              {q.tipo === 'ESCALA' ? (
                <>
                  <span className={`text-[28px] leading-none font-black tracking-[-0.04em] ${marcada ? 'text-accent-2-800' : 'text-accent-700'}`}>
                    {o.valor}
                  </span>
                  <span className="text-[13px] leading-tight font-extrabold">{o.etiqueta}</span>
                </>
              ) : conTarjetas ? (
                <>
                  {icono && (
                    <span
                      className={`grid size-12 place-items-center rounded-full border ${marcada ? 'border-accent-2-600 bg-bg' : 'border-divider bg-neutral-100'}`}
                    >
                      <Icon name={icono} size={24} className={marcada ? 'text-accent-2-700' : 'text-accent-700'} />
                    </span>
                  )}
                  <span>
                    <span className="mb-1 block text-base font-black tracking-[-0.02em]">{o.etiqueta}</span>
                    {o.nota && <span className="block text-[12.5px] leading-[1.4] font-semibold text-neutral-700">{o.nota}</span>}
                  </span>
                </>
              ) : (
                <>
                  {icono && <Icon name={icono} className={marcada ? "[font-variation-settings:'FILL'_1]" : ''} />}
                  {o.etiqueta}
                  {marcada && <Icon name="check" size={16} />}
                </>
              )}
            </label>
          );
        })}
      </div>

      {multiple && (
        <p className="m-0 flex items-center gap-2.5 text-[13px] font-extrabold text-neutral-700" aria-live="polite">
          <Icon name="checklist" size={17} />
          {lista.length === 0
            ? q.obligatoria
              ? 'Selecciona al menos una opción'
              : 'Opcional: puedes seguir sin marcar'
            : `${lista.length} ${lista.length === 1 ? 'seleccionada' : 'seleccionadas'}${limite ? ` de ${limite} como máximo` : ''}`}
        </p>
      )}

      {q.tipo === 'ESCALA' && elegida?.nota && (
        <p className="m-0 flex gap-[11px] rounded-[18px] border border-accent-2-500 bg-accent-2-200 px-[17px] py-[15px] text-[13px] font-bold text-accent-2-900">
          <Icon name="info" size={19} />
          {elegida.nota}
        </p>
      )}
      {/* Aviso propio de la opcion (p. ej. Salud Responde en intensidad alta): se anuncia al aparecer. */}
      {q.opciones
        .filter((o) => lista.includes(o.valor) && o.mensaje)
        .map((o) => (
          <p
            key={o.valor}
            role="alert"
            className="m-0 flex gap-[11px] rounded-[18px] border border-accent-500 bg-accent-200 px-[17px] py-[15px] text-[14px] font-extrabold text-pretty text-accent-900"
          >
            <Icon name="call" size={19} />
            {o.mensaje}
          </p>
        ))}
    </fieldset>
  );
}
