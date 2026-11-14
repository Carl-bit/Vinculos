'use client';

import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Icon } from './Icon';

/*
 * Selectores con el estilo del sistema de diseño. Regla: ningun popup nativo
 * del navegador (lista de <select>, calendario de type="date", reloj de
 * type="time", flechas de type="number"). `Select` e `Input` (Field.tsx)
 * delegan aqui y conservan su API: `value` + `onChange(e)` con
 * `e.target.value` (y `valueAsNumber` en numeros).
 *
 * El panel se abre en la capa superior del navegador (Popover API): no lo
 * recortan tarjetas con overflow ni queda debajo de un Modal.
 */

/** Evento minimo compatible con los manejadores existentes (`e.target.value`). */
export function eventoValor<T extends HTMLInputElement | HTMLSelectElement>(valor: string, name?: string): ChangeEvent<T> {
  const target = { value: valor, name: name ?? '', valueAsNumber: valor === '' ? Number.NaN : Number(valor) };
  return { target, currentTarget: target } as unknown as ChangeEvent<T>;
}

/** Dentro de un <label>, un clic en el panel reactivaria el boton del control: se cancela. */
const sinEtiqueta = (e: { preventDefault: () => void }) => e.preventDefault();

/** Posiciona un panel en la capa superior bajo (o sobre) su ancla y lo cierra al hacer clic fuera. */
function usePanel(abierto: boolean, cerrar: () => void) {
  const ancla = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [estilo, setEstilo] = useState<CSSProperties>({});

  const ubicar = useCallback(() => {
    // Se mide el control visible (el boton), no el contenedor: puede ser mas ancho.
    const a = (ancla.current?.querySelector('button') ?? ancla.current)?.getBoundingClientRect();
    const p = panel.current;
    if (!a || !p) return;
    const alto = p.offsetHeight;
    const abajo = window.innerHeight - a.bottom;
    const arriba = abajo < alto + 12 && a.top > abajo;
    const ancho = Math.max(a.width, p.offsetWidth);
    const left = Math.min(Math.max(8, a.left), window.innerWidth - ancho - 8);
    setEstilo({
      position: 'fixed',
      left,
      minWidth: a.width,
      maxWidth: Math.max(a.width, 420),
      top: arriba ? Math.max(8, a.top - alto - 6) : a.bottom + 6,
    });
  }, []);

  useLayoutEffect(() => {
    const p = panel.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!p) return;
    if (abierto) {
      try {
        p.showPopover?.();
      } catch {
        /* ya abierto */
      }
      ubicar();
    } else {
      try {
        p.hidePopover?.();
      } catch {
        /* ya cerrado */
      }
    }
  }, [abierto, ubicar]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ancla.current?.contains(t) && !panel.current?.contains(t)) cerrar();
    };
    window.addEventListener('pointerdown', fuera);
    window.addEventListener('resize', ubicar);
    window.addEventListener('scroll', ubicar, true);
    return () => {
      window.removeEventListener('pointerdown', fuera);
      window.removeEventListener('resize', ubicar);
      window.removeEventListener('scroll', ubicar, true);
    };
  }, [abierto, cerrar, ubicar]);

  // Dentro de un Modal (<dialog>): Esc con el panel abierto cierra solo el panel.
  // El navegador dispara `cancel` del dialog DESPUES del keydown que ya cerro el
  // panel; por eso se recuerda ese Esc unos ms y el listener vive mientras exista el control.
  const abiertoRef = useRef(abierto);
  const escHasta = useRef(0);
  useLayoutEffect(() => {
    abiertoRef.current = abierto;
  }, [abierto]);
  useEffect(() => {
    if (!abierto) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') escHasta.current = Date.now() + 300;
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [abierto]);
  useEffect(() => {
    const d = ancla.current?.closest('dialog');
    if (!d) return;
    const cancelar = (e: Event) => {
      if (!abiertoRef.current && Date.now() > escHasta.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cerrar();
      ancla.current?.querySelector('button')?.focus();
    };
    d.addEventListener('cancel', cancelar, true);
    return () => d.removeEventListener('cancel', cancelar, true);
  }, [cerrar]);

  // En el panel: un clic no reactiva el <label> que envuelve al control, y Esc
  // cierra y devuelve el foco al control (listeners por codigo: el panel no es interactivo).
  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      cerrar();
      ancla.current?.querySelector('button')?.focus();
    };
    p.addEventListener('click', sinEtiqueta);
    p.addEventListener('keydown', tecla);
    return () => {
      p.removeEventListener('click', sinEtiqueta);
      p.removeEventListener('keydown', tecla);
    };
  }, [cerrar]);

  return { ancla, panel, estilo };
}

const PANEL = 'm-0 rounded-[18px] border-[1.5px] border-neutral-400 bg-bg p-1.5 text-text shadow-flotante';
const BOTON =
  'control flex w-full cursor-pointer items-center gap-2 text-left font-body text-[15px] text-text bg-bg border-[1.5px] border-neutral-400 px-[18px] py-3.5 rounded-full hover:border-accent-500 focus-visible:border-accent-500 aria-expanded:border-accent-500 data-[cambiado=true]:border-arcilla data-[cambiado=true]:bg-papel aria-[invalid=true]:border-accent-700 disabled:cursor-not-allowed disabled:opacity-60';

interface OpcionLista {
  valor: string;
  etiqueta: ReactNode;
  disabled?: boolean;
}

/**
 * Las clases de tamaño y posicion en la fila (`w-`, `max-w-`, `flex-`, `self-`...)
 * van al contenedor; el resto (relleno, texto) al boton. Asi `className` se
 * comporta como en el <select> nativo que reemplaza.
 */
const CAJA = /^!?(w-|min-w-|max-w-|flex-|basis-|grow|shrink|self-|order-|col-|row-|m[trblxy]?-|-m[trblxy]?-)/;
function repartirClases(className: string): [string, string] {
  const caja: string[] = [];
  const boton: string[] = [];
  for (const c of className.split(/\s+/).filter(Boolean)) (CAJA.test(c.replace(/^[a-z]+:/, '')) ? caja : boton).push(c);
  return [caja.join(' '), boton.join(' ')];
}

/** Lee los <option> hijos (tambien dentro de fragmentos y condicionales). */
function leerOpciones(children: ReactNode): OpcionLista[] {
  const res: OpcionLista[] = [];
  const recorrer = (n: ReactNode) =>
    Children.forEach(n, (c) => {
      if (!isValidElement(c)) return;
      const el = c as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
      if (el.type === 'option') {
        const texto = el.props.children;
        res.push({ valor: String(el.props.value ?? (typeof texto === 'string' || typeof texto === 'number' ? texto : '')), etiqueta: texto, disabled: el.props.disabled });
      } else if (el.props.children) recorrer(el.props.children);
    });
  recorrer(children);
  return res;
}

type PropsLista = {
  id?: string;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'data-cambiado'?: boolean;
  title?: string;
  /** Tamaño compacto (barras de filtros, paginador). */
  compacto?: boolean;
};

/** Lista desplegable propia (reemplaza la de <select>). Teclado: flechas, Inicio/Fin, Enter, Esc y escribir para saltar. */
export function ListaSeleccion({ id, value, defaultValue, onChange, children, disabled, required, name, className = '', compacto, title, ...aria }: PropsLista) {
  const opciones = leerOpciones(children);
  const [interno, setInterno] = useState(String(defaultValue ?? opciones[0]?.valor ?? ''));
  const valor = value !== undefined ? String(value) : interno;
  const actual = opciones.findIndex((o) => o.valor === valor);
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(Math.max(0, actual));
  const cerrar = useCallback(() => setAbierto(false), []);
  const { ancla, panel, estilo } = usePanel(abierto, cerrar);
  const lista = useRef<HTMLUListElement>(null);
  const idLista = useId();
  const busqueda = useRef({ texto: '', hasta: 0 });

  useEffect(() => {
    if (abierto) {
      setActiva(Math.max(0, actual));
      requestAnimationFrame(() => lista.current?.focus());
    }
  }, [abierto, actual]);
  useEffect(() => {
    if (abierto) lista.current?.querySelector(`[data-i="${activa}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activa, abierto]);

  const boton = () => ancla.current?.querySelector('button');
  const elegir = (i: number) => {
    const o = opciones[i];
    if (!o || o.disabled) return;
    if (value === undefined) setInterno(o.valor);
    if (o.valor !== valor) onChange?.(eventoValor<HTMLSelectElement>(o.valor, name));
    setAbierto(false);
    boton()?.focus();
  };
  const saltar = (dir: 1 | -1, desde: number) => {
    let i = desde;
    do i += dir;
    while (i >= 0 && i < opciones.length && opciones[i].disabled);
    return i >= 0 && i < opciones.length ? i : desde;
  };
  const tecla = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActiva((i) => saltar(1, i));
    else if (e.key === 'ArrowUp') setActiva((i) => saltar(-1, i));
    else if (e.key === 'Home') setActiva(saltar(1, -1));
    else if (e.key === 'End') setActiva(saltar(-1, opciones.length));
    else if (e.key === 'Enter' || e.key === ' ') elegir(activa);
    else if (e.key === 'Escape') {
      setAbierto(false);
      boton()?.focus();
    } else if (e.key === 'Tab') return setAbierto(false);
    else if (e.key.length === 1) {
      const b = busqueda.current;
      b.texto = (Date.now() < b.hasta ? b.texto : '') + e.key.toLowerCase();
      b.hasta = Date.now() + 700;
      const i = opciones.findIndex((o) => !o.disabled && String(typeof o.etiqueta === 'string' ? o.etiqueta : o.valor).toLowerCase().startsWith(b.texto));
      if (i >= 0) setActiva(i);
    } else return;
    e.preventDefault();
  };

  const [clasesCaja, clasesBoton] = repartirClases(className);
  return (
    <div ref={ancla} className={`relative min-w-0 ${clasesCaja || (compacto ? '' : 'w-full')}`}>
      <button
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={idLista}
        data-valor={valor}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        data-cambiado={aria['data-cambiado']}
        className={
          compacto
            ? `flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-divider bg-bg px-3 text-[12.5px] font-bold text-text hover:border-accent-500 aria-expanded:border-accent-500 disabled:cursor-not-allowed disabled:opacity-60 ${clasesBoton}`
            : `${BOTON} ${clasesBoton}`
        }
        onClick={() => setAbierto((a) => !a)}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            setAbierto(true);
          }
        }}
      >
        <span className={`min-w-0 flex-1 truncate ${actual < 0 ? 'text-neutral-700' : ''}`}>{actual < 0 ? 'Elige una opción' : opciones[actual].etiqueta}</span>
        <Icon name="expand_more" size={compacto ? 16 : 20} className={`flex-none text-neutral-700 transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {(name || required) && <input className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0" tabIndex={-1} aria-hidden="true" name={name} required={required} value={valor} onChange={() => undefined} />}
      <div ref={panel} popover="manual" style={estilo} className={`${PANEL} max-h-[min(320px,50dvh)] overflow-y-auto`}>
        {abierto && (
          <ul ref={lista} id={idLista} role="listbox" tabIndex={-1} aria-activedescendant={`${idLista}-${activa}`} onKeyDown={tecla} className="m-0 flex list-none flex-col gap-0.5 p-0 outline-none">
            {opciones.map((o, i) => (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- patron listbox: el teclado lo maneja la lista (aria-activedescendant)
              <li
                key={`${o.valor}-${i}`}
                id={`${idLista}-${i}`}
                data-i={i}
                role="option"
                aria-selected={o.valor === valor}
                aria-disabled={o.disabled || undefined}
                onPointerEnter={() => !o.disabled && setActiva(i)}
                onClick={() => elegir(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-[12px] px-3.5 py-2.5 text-[14.5px] ${i === activa ? 'bg-accent-200' : ''} ${
                  o.valor === valor ? 'font-extrabold text-accent-800' : 'font-semibold'
                } aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
              >
                <span className="min-w-0 flex-1">{o.etiqueta}</span>
                {o.valor === valor && <Icon name="check" size={17} className="flex-none" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'];
const dos = (n: number) => String(n).padStart(2, '0');
const iso = (a: number, m: number, d: number) => `${a}-${dos(m + 1)}-${dos(d)}`;
const hoyIso = () => {
  const d = new Date();
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};

/** Calendario de un mes (lunes primero) con limites min/max en YYYY-MM-DD. */
function Calendario({ valor, min, max, onElegir }: { valor: string; min?: string; max?: string; onElegir: (v: string) => void }) {
  const base = valor || (min && min > hoyIso() ? min : max && max < hoyIso() ? max : hoyIso());
  const [a0, m0] = base.split('-').map(Number);
  const [vista, setVista] = useState({ a: a0, m: m0 - 1 });
  const [foco, setFoco] = useState(Number(base.split('-')[2]));
  const rejilla = useRef<HTMLDivElement>(null);
  const primero = (new Date(vista.a, vista.m, 1).getDay() + 6) % 7;
  const diasMes = new Date(vista.a, vista.m + 1, 0).getDate();
  const fuera = (v: string) => (!!min && v < min) || (!!max && v > max);
  const hoy = hoyIso();
  const mover = (d: number) => setVista(({ a, m }) => ({ a: a + Math.floor((m + d) / 12), m: (((m + d) % 12) + 12) % 12 }));

  useEffect(() => {
    rejilla.current?.querySelector<HTMLButtonElement>(`[data-dia="${foco}"]`)?.focus();
  }, [foco, vista]);

  const tecla = (e: KeyboardEvent) => {
    const paso = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (paso === undefined) return;
    e.preventDefault();
    const n = foco + paso;
    if (n < 1) {
      mover(-1);
      setFoco(new Date(vista.a, vista.m, 0).getDate() + n);
    } else if (n > diasMes) {
      mover(1);
      setFoco(n - diasMes);
    } else setFoco(n);
  };

  return (
    <div className="flex w-[292px] flex-col gap-2 p-1.5">
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Mes anterior" onClick={() => mover(-1)} className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200">
          <Icon name="chevron_left" size={20} />
        </button>
        <span className="text-[14.5px] font-extrabold first-letter:uppercase" aria-live="polite">
          {MESES[vista.m]} {vista.a}
        </span>
        <button type="button" aria-label="Mes siguiente" onClick={() => mover(1)} className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-accent-200">
          <Icon name="chevron_right" size={20} />
        </button>
      </div>
      <div ref={rejilla} role="grid" tabIndex={-1} aria-label={`${MESES[vista.m]} ${vista.a}`} className="grid grid-cols-7 gap-0.5 outline-none" onKeyDown={tecla}>
        {DIAS.map((d) => (
          <span key={d} className="py-1 text-center text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">
            {d}
          </span>
        ))}
        {Array.from({ length: primero }, (_, i) => (
          <span key={`v${i}`} />
        ))}
        {Array.from({ length: diasMes }, (_, i) => {
          const d = i + 1;
          const v = iso(vista.a, vista.m, d);
          const elegido = v === valor;
          return (
            <button
              key={d}
              type="button"
              data-dia={d}
              tabIndex={d === foco ? 0 : -1}
              disabled={fuera(v)}
              aria-pressed={elegido}
              aria-current={v === hoy ? 'date' : undefined}
              onClick={() => onElegir(v)}
              className={`grid h-9 cursor-pointer place-items-center rounded-full text-[14px] font-bold tabular-nums disabled:cursor-not-allowed disabled:opacity-35 ${
                elegido ? 'bg-accent-600 text-white' : v === hoy ? 'text-accent-800 ring-[1.5px] ring-accent-500 ring-inset' : 'hover:bg-accent-200'
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
      {!fuera(hoy) && (
        <button type="button" onClick={() => onElegir(hoy)} className="cursor-pointer self-start rounded-full px-3 py-1.5 text-[13px] font-extrabold text-accent-800 hover:bg-accent-200">
          Hoy
        </button>
      )}
    </div>
  );
}

type PropsCampo = {
  id?: string;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'data-cambiado'?: boolean;
};

function useValor(value: PropsCampo['value'], defaultValue: PropsCampo['defaultValue'], onChange: PropsCampo['onChange'], name?: string) {
  const [interno, setInterno] = useState(String(defaultValue ?? ''));
  const valor = value !== undefined ? String(value) : interno;
  const fijar = (v: string) => {
    if (value === undefined) setInterno(v);
    onChange?.(eventoValor<HTMLInputElement>(v, name));
  };
  return [valor, fijar] as const;
}

const legibleFecha = (v: string) => {
  const [a, m, d] = v.split('-').map(Number);
  return a ? `${dos(d)}-${dos(m)}-${a}` : '';
};

/** Reemplazo de type="date" (valor YYYY-MM-DD). */
export function CampoFecha({ id, value, defaultValue, onChange, min, max, disabled, required, name, placeholder, className = '', ...aria }: PropsCampo) {
  const [valor, fijar] = useValor(value, defaultValue, onChange, name);
  const [abierto, setAbierto] = useState(false);
  const cerrar = useCallback(() => setAbierto(false), []);
  const { ancla, panel, estilo } = usePanel(abierto, cerrar);
  const [clasesCaja, clasesBoton] = repartirClases(className);
  const idPanel = useId();
  return (
    <div ref={ancla} className={`relative min-w-0 ${clasesCaja || 'w-full'}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-haspopup="dialog"
        aria-controls={idPanel}
        aria-expanded={abierto}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        data-cambiado={aria['data-cambiado']}
        className={`${BOTON} ${clasesBoton}`}
        onClick={() => setAbierto((a) => !a)}
      >
        <span className={`min-w-0 flex-1 truncate tabular-nums ${valor ? '' : 'text-neutral-700'}`}>{valor ? legibleFecha(valor) : (placeholder ?? 'dd-mm-aaaa')}</span>
        <Icon name="calendar_month" size={19} className="flex-none text-neutral-700" />
      </button>
      {(name || required) && <input className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0" tabIndex={-1} aria-hidden="true" name={name} required={required} value={valor} onChange={() => undefined} />}
      <div ref={panel} id={idPanel} popover="manual" style={estilo} className={PANEL} role="dialog" aria-label={aria['aria-label'] ?? 'Elegir fecha'}>
        {abierto && (
          <>
            <Calendario
              valor={valor}
              min={min !== undefined ? String(min) : undefined}
              max={max !== undefined ? String(max) : undefined}
              onElegir={(v) => {
                fijar(v);
                setAbierto(false);
                ancla.current?.querySelector('button')?.focus();
              }}
            />
            {valor && !required && (
              <button
                type="button"
                onClick={() => {
                  fijar('');
                  setAbierto(false);
                }}
                className="mx-1.5 mb-1.5 cursor-pointer rounded-full px-3 py-1.5 text-[13px] font-extrabold text-neutral-800 hover:bg-neutral-200"
              >
                Borrar fecha
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Reemplazo de type="time" (valor HH:MM). `step` en segundos define los minutos ofrecidos (por defecto cada 5). */
export function CampoHora({ id, value, defaultValue, onChange, min, max, step, disabled, required, name, className = '', ...aria }: PropsCampo) {
  const [valor, fijar] = useValor(value, defaultValue, onChange, name);
  const pasoMin = Math.max(1, Math.round(Number(step ?? 300) / 60));
  const lim = (s: unknown, d: string) => (typeof s === 'string' && /^\d{2}:\d{2}/.test(s) ? s.slice(0, 5) : d);
  const desde = lim(min, '00:00');
  const hasta = lim(max, '23:59');
  const opciones: string[] = [];
  for (let t = 0; t < 24 * 60; t += pasoMin) {
    const v = `${dos(Math.floor(t / 60))}:${dos(t % 60)}`;
    if (v >= desde && v <= hasta) opciones.push(v);
  }
  if (valor && !opciones.includes(valor.slice(0, 5))) opciones.push(valor.slice(0, 5));
  opciones.sort();
  return (
    <ListaSeleccion
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      className={`tabular-nums ${className}`}
      value={valor.slice(0, 5)}
      onChange={(e) => fijar(e.target.value)}
      aria-label={aria['aria-label']}
      aria-describedby={aria['aria-describedby']}
      aria-invalid={aria['aria-invalid']}
      data-cambiado={aria['data-cambiado']}
    >
      {!valor && <option value="">--:--</option>}
      {opciones.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </ListaSeleccion>
  );
}

/** Reemplazo de type="number": texto numerico con botones - y + propios (sin las flechas nativas). */
export function CampoNumero({ id, value, defaultValue, onChange, min, max, step, disabled, required, name, placeholder, className = '', ...aria }: PropsCampo & { inputMode?: 'numeric' | 'decimal' }) {
  const [valor, fijar] = useValor(value, defaultValue, onChange, name);
  const paso = Number(step ?? 1) || 1;
  const decimales = String(paso).split('.')[1]?.length ?? 0;
  const nMin = min !== undefined && min !== '' ? Number(min) : undefined;
  const nMax = max !== undefined && max !== '' ? Number(max) : undefined;
  const acotar = (n: number) => Math.min(nMax ?? Infinity, Math.max(nMin ?? -Infinity, Number(n.toFixed(decimales))));
  const actual = valor === '' ? undefined : Number(valor);
  const mover = (dir: 1 | -1) => {
    const base = actual ?? (placeholder && !Number.isNaN(Number(placeholder)) ? Number(placeholder) : (nMin ?? 0));
    fijar(String(acotar(base + dir * paso)));
  };
  const btn = 'grid w-11 flex-none cursor-pointer place-items-center text-text hover:text-accent-700 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div
      className={`flex w-full min-w-0 items-stretch overflow-hidden rounded-full border-[1.5px] border-neutral-400 bg-bg focus-within:border-accent-500 has-[[aria-invalid=true]]:border-accent-700 has-[[data-cambiado=true]]:border-arcilla ${disabled ? 'opacity-60' : ''}`}
    >
      <input
        id={id}
        name={name}
        required={required}
        disabled={disabled}
        inputMode={decimales ? 'decimal' : 'numeric'}
        role="spinbutton"
        aria-valuenow={actual}
        aria-valuemin={nMin}
        aria-valuemax={nMax}
        aria-label={aria['aria-label']}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        data-cambiado={aria['data-cambiado']}
        placeholder={placeholder}
        value={valor}
        className={`order-2 min-w-0 flex-1 bg-transparent px-1 py-3.5 text-center font-body text-[15px] text-text tabular-nums outline-none placeholder:text-neutral-700 ${className}`}
        onChange={(e) => {
          const t = e.target.value.replace(',', '.');
          if (/^-?\d*\.?\d*$/.test(t)) fijar(t);
        }}
        onBlur={() => {
          if (actual !== undefined && !Number.isNaN(actual) && acotar(actual) !== actual) fijar(String(acotar(actual)));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            mover(e.key === 'ArrowUp' ? 1 : -1);
          }
        }}
      />
      <button type="button" tabIndex={-1} aria-label="Restar" disabled={disabled || (actual !== undefined && nMin !== undefined && actual <= nMin)} onClick={() => mover(-1)} className={`order-1 ${btn}`}>
        <span aria-hidden="true" className="text-[20px] leading-none font-bold">
          −
        </span>
      </button>
      <button type="button" tabIndex={-1} aria-label="Sumar" disabled={disabled || (actual !== undefined && nMax !== undefined && actual >= nMax)} onClick={() => mover(1)} className={`order-3 ${btn}`}>
        <Icon name="add" size={18} />
      </button>
    </div>
  );
}
