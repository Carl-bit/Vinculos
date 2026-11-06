'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { EstadoConsulta } from '@/components/shared/EstadoVista';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { useContenidoPublico, type ContenidoPublico } from '@/lib/centro';
import { buscarColores, nombreDeColor, tonoLegible } from '@/lib/coloresNombrados';
import { contraste, CREMA, esHex, fondoValido, MINIMO_FONDO, MINIMO_PRINCIPAL, principalValido, SISTEMA, TINTA, type Zona } from '@/lib/marca';

import { BarraGuardado } from './BarraGuardado';

type Campo = 'colorMarca' | 'colorFondoPublico' | 'colorPortal' | 'colorFondoPortal' | 'colorPanel' | 'colorFondoPanel';
type Colores = Record<Campo, string>;

const ZONAS: { zona: Zona; nombre: string; bajada: string; principal: Campo; fondo: Campo }[] = [
  {
    zona: 'publico',
    nombre: 'Sitio público',
    bajada: 'Portada, equipo, match y pedir hora. Los cambios se ven en unos minutos.',
    principal: 'colorMarca',
    fondo: 'colorFondoPublico',
  },
  { zona: 'portal', nombre: 'Portal del paciente', bajada: 'Mi cuenta, horas, pagos y consentimientos.', principal: 'colorPortal', fondo: 'colorFondoPortal' },
  {
    zona: 'panel',
    nombre: 'Panel del equipo',
    bajada: 'Todos los módulos internos. La barra lateral no cambia.',
    principal: 'colorPanel',
    fondo: 'colorFondoPanel',
  },
];

/** Sugeridos que cumplen el contraste sobre crema; el hexadecimal admite cualquier otro que cumpla. */
const SUGERIDOS: [string, string][] = [
  ['Arcilla', '#8A4B1F'],
  ['Oliva', '#4F6B2F'],
  ['Océano', '#2F5A7A'],
  ['Ciruela', '#6B3A5C'],
  ['Tinta', '#2B2420'],
];

const desde = (p: ContenidoPublico): Colores => ({
  colorMarca: p.colorMarca ?? '',
  colorFondoPublico: p.colorFondoPublico ?? '',
  colorPortal: p.colorPortal ?? '',
  colorFondoPortal: p.colorFondoPortal ?? '',
  colorPanel: p.colorPanel ?? '',
  colorFondoPanel: p.colorFondoPanel ?? '',
});

/** Vacio = color del sistema. Devuelve el error de un color escrito o elegido. */
function errorColor(v: string, tipo: 'principal' | 'fondo'): string | undefined {
  if (!v) return undefined;
  if (!esHex(v)) return 'Usa el formato #RRGGBB.';
  if (tipo === 'principal' && !principalValido(v))
    return `Muy claro: sobre las tarjetas crema se lee a ${contraste(v, CREMA).toFixed(1)}:1 y necesita ${MINIMO_PRINCIPAL}:1.`;
  if (tipo === 'fondo' && !fondoValido(v)) return `Muy oscuro: el texto se lee a ${contraste(v, TINTA).toFixed(1)}:1 y necesita ${MINIMO_FONDO}:1.`;
  return undefined;
}

/**
 * Marca y apariencia (03c): color principal y de fondo por zona. Solo la
 * cuenta madre. La BD exige el contraste (contenido_publico_colores); las
 * tarjetas quedan siempre en crema.
 */
export function MarcaCentro() {
  const contenido = useContenidoPublico();
  const [descartes, setDescartes] = useState(0);
  return <EstadoConsulta consulta={contenido}>{(p) => <Formulario key={descartes} p={p} onDescartar={() => setDescartes((n) => n + 1)} />}</EstadoConsulta>;
}

function Formulario({ p, onDescartar }: { p: ContenidoPublico; onDescartar: () => void }) {
  const cliente = useQueryClient();
  const base = desde(p);
  const [c, setC] = useState<Colores>(base);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string>();
  const cambiado = (Object.keys(c) as Campo[]).some((k) => c[k].toUpperCase() !== base[k].toUpperCase());
  const poner = (k: Campo, v: string) => {
    setGuardado(false);
    setC((x) => ({ ...x, [k]: v.trim() }));
  };
  const errores = ZONAS.flatMap((z) => [errorColor(c[z.principal], 'principal'), errorColor(c[z.fondo], 'fondo')]).filter(Boolean);

  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/configuracion/contenido-publico', {
          body: Object.fromEntries((Object.keys(c) as Campo[]).map((k) => [k, c[k] ? c[k].toUpperCase() : null])),
        }),
      ),
    onSuccess: () => {
      setError(undefined);
      setGuardado(true);
      void cliente.invalidateQueries({ queryKey: ['configuracion'] });
      void cliente.invalidateQueries({ queryKey: ['publico', 'centro'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar los colores.'),
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (errores.length) return setError('Revisa los colores marcados: no se leerían bien.');
        guardar.mutate();
      }}
      className="flex flex-col gap-[18px]"
    >
      <div className="grid gap-[18px] 2xl:grid-cols-3">
        {ZONAS.map((z) => {
          const principal = esHex(c[z.principal]) && principalValido(c[z.principal]) ? c[z.principal] : SISTEMA[z.zona].principal;
          const fondo = esHex(c[z.fondo]) && fondoValido(c[z.fondo]) ? c[z.fondo] : SISTEMA[z.zona].fondo;
          return (
            <Card key={z.zona} variante="crema" aria-labelledby={`marca-${z.zona}`} className="flex min-w-0 flex-col gap-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id={`marca-${z.zona}`} className="m-0 text-[17px] font-black">
                  {z.nombre}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!c[z.principal] && !c[z.fondo]}
                  onClick={() => {
                    poner(z.principal, '');
                    poner(z.fondo, '');
                  }}
                  className="!px-3 !py-2 !text-[12.5px]"
                >
                  Usar los del sistema
                </Button>
              </div>
              <span className="-mt-2 text-[12.5px] font-semibold text-neutral-800">{z.bajada}</span>

              <CampoColor
                etiqueta="Color principal"
                tipo="principal"
                ayuda="Botones, enlaces y elementos activos."
                valor={c[z.principal]}
                sistema={SISTEMA[z.zona].principal}
                cambiado={c[z.principal].toUpperCase() !== base[z.principal].toUpperCase()}
                error={errorColor(c[z.principal], 'principal')}
                onChange={(v) => poner(z.principal, v)}
              />
              <div role="group" aria-label={`Colores sugeridos para ${z.nombre}`} className="-mt-1 flex flex-wrap gap-2">
                {SUGERIDOS.map(([nombre, hex]) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={nombre}
                    aria-pressed={c[z.principal].toUpperCase() === hex}
                    onClick={() => poner(z.principal, hex)}
                    className={`size-11 cursor-pointer rounded-full border-[3px] ${c[z.principal].toUpperCase() === hex ? 'border-tinta' : 'border-bg'}`}
                    style={{ background: hex }}
                  />
                ))}
              </div>
              <CampoColor
                etiqueta="Color de fondo"
                tipo="fondo"
                ayuda="El lienzo con puntos detrás de las tarjetas."
                valor={c[z.fondo]}
                sistema={SISTEMA[z.zona].fondo}
                cambiado={c[z.fondo].toUpperCase() !== base[z.fondo].toUpperCase()}
                error={errorColor(c[z.fondo], 'fondo')}
                onChange={(v) => poner(z.fondo, v)}
              />

              {/* Vista previa: lienzo con puntos de la zona, tarjeta crema, boton y enlace con el principal. */}
              <div
                aria-hidden
                className="rounded-tarjeta border border-borde p-4"
                style={{
                  backgroundColor: fondo,
                  backgroundImage: `radial-gradient(color-mix(in srgb, ${fondo} 86%, ${TINTA}) 1px, transparent 1px)`,
                  backgroundSize: '18px 18px',
                }}
              >
                <div className="flex flex-col gap-2.5 rounded-tarjeta border border-borde bg-bg p-3.5 shadow-suave">
                  <span className="text-[11px] font-extrabold tracking-[0.1em] text-neutral-800 uppercase">Así se ve</span>
                  <span className="text-[15px] font-black">Tarjeta del {z.nombre.toLowerCase()}</span>
                  <span className="text-[13px] font-extrabold underline" style={{ color: principal }}>
                    Un enlace
                  </span>
                  <span
                    className="inline-flex min-h-10 items-center self-start rounded-full px-[18px] text-[13.5px] font-extrabold text-white"
                    style={{ background: principal }}
                  >
                    Botón principal
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <BarraGuardado
        seccion="Marca y apariencia"
        error={error}
        guardado={guardado}
        cambiado={cambiado}
        guardando={guardar.isPending}
        onDescartar={onDescartar}
      />
    </form>
  );
}

function CampoColor({
  etiqueta,
  ayuda,
  tipo,
  valor,
  sistema,
  cambiado,
  error,
  onChange,
}: {
  etiqueta: string;
  ayuda: string;
  tipo: 'principal' | 'fondo';
  valor: string;
  sistema: string;
  cambiado: boolean;
  error?: string;
  onChange: (v: string) => void;
}) {
  // Lo escrito: un #RRGGBB (se aplica al tiro) o un nombre ("rojo") que despliega los tonos del catalogo.
  const [texto, setTexto] = useState(valor);
  const [previo, setPrevio] = useState(valor);
  if (valor !== previo) {
    setPrevio(valor);
    setTexto(valor);
  }
  const palabra = texto.trim();
  const buscando = palabra !== '' && !palabra.startsWith('#');
  const tonos = buscando ? buscarColores(palabra) : [];
  // Todos los tonos que calzan; el que no se leeria bien se ofrece ajustado (mas oscuro o mas claro).
  const opciones = tonos
    .map((t) => ({ nombre: t.nombre, ...tonoLegible(t.hex, tipo) }))
    // Un tono muy claro oscurecido mas de 60 % se vuelve gris barroso: ese queda para el fondo.
    .filter((o) => o.cuanto <= 0.6)
    .filter((o, i, l) => l.findIndex((x) => x.hex === o.hex) === i)
    .slice(0, 14);
  const ajuste = tipo === 'principal' ? 'más oscuro' : 'más claro';
  const elegir = (hex: string) => {
    setTexto(hex);
    onChange(hex);
  };
  const nombre = esHex(valor) ? nombreDeColor(valor) : undefined;
  const delSistema = nombreDeColor(sistema);
  const hint = buscando
    ? 'Elige un tono de la lista: se guarda su código.'
    : !valor
      ? `${ayuda} Ahora: el del sistema (${sistema}${delSistema ? `, ${delSistema}` : ''}).`
      : nombre
        ? `${ayuda} Elegido: ${valor.toUpperCase()} (${nombre}).`
        : ayuda;
  return (
    <Field label={etiqueta} hint={hint} error={buscando ? undefined : error} cambiado={cambiado}>
      {(x) => (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <input
              type="color"
              aria-label={`Elegir ${etiqueta.toLowerCase()} en la paleta`}
              value={esHex(valor) ? valor.toLowerCase() : sistema.toLowerCase()}
              onChange={(e) => elegir(e.target.value.toUpperCase())}
              className="size-11 flex-none cursor-pointer appearance-none overflow-hidden rounded-full border border-borde bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
            />
            <Input
              {...x}
              value={texto}
              maxLength={30}
              autoComplete="off"
              placeholder={`${sistema} o un nombre: rojo, azul…`}
              onChange={(e) => {
                const v = e.target.value;
                setTexto(v);
                if (!v.trim() || v.trim().startsWith('#')) onChange(v.trim());
              }}
              className="!py-2.5"
            />
          </div>
          <div aria-live="polite">
            {buscando && (
              <div role="group" aria-label={`Tonos de «${palabra}»`} className="flex flex-wrap gap-1.5">
                {opciones.map((t) => (
                  <button
                    key={t.hex}
                    type="button"
                    onClick={() => elegir(t.hex)}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-borde bg-bg py-1 pr-3.5 pl-1.5 text-[12.5px] font-bold hover:border-accent-500"
                  >
                    <span aria-hidden className="size-8 flex-none rounded-full border border-borde" style={{ background: t.hex }} />
                    {t.hex} ({t.ajustado ? `${t.nombre}, ${ajuste}` : t.nombre})
                  </button>
                ))}
                {tonos.length > 0 && opciones.length === 0 && (
                  <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
                    «{palabra}» es un tono claro: sirve como color de fondo, no como color principal (el texto no se leería).
                  </p>
                )}
                {tonos.length === 0 && (
                  <p className="m-0 text-[12.5px] font-semibold text-neutral-800">
                    No conocemos «{palabra}». Prueba con rojo, naranjo, amarillo, verde, azul, morado, rosado, café o gris, o escribe el código #RRGGBB.
                  </p>
                )}
                {opciones.some((o) => o.ajustado) && (
                  <p className="m-0 w-full text-[12px] font-semibold text-neutral-800">
                    Los marcados «{ajuste}» se ajustaron para que{' '}
                    {tipo === 'principal' ? 'el texto se lea bien sobre las tarjetas' : 'el texto se lea bien encima'}.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Field>
  );
}
