'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { BarraFlotante, SeparadorBarra } from '@/components/ui/BarraFlotante';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Interruptor } from '@/components/ui/Interruptor';
import { Pestanas } from '@/components/ui/Pestanas';

import { BarraSinGuardar, DialogoDescartar, EditorEnfocado, SeccionEnfocable, useGuardaCambios } from './EdicionSegura';

/** Muestrario de Moderno A (03c, fase 1): solo desarrollo, en /dev/estilo. */
const COLORES = [
  ['tinta', 'bg-tinta', '#2B2420'],
  ['arcilla', 'bg-arcilla', '#8A4B1F'],
  ['oliva', 'bg-oliva', '#4F6B2F'],
  ['papel', 'bg-papel', '#FFFDF9'],
  ['lienzo', 'bg-lienzo', '#F1EBE2'],
  ['punto', 'bg-punto', '#D6CBBB'],
  ['borde', 'bg-borde', '#E3D7C4'],
] as const;

const SECCIONES = { cab: 'Cabecera', sobre: 'Sobre mí' } as const;
type Seccion = keyof typeof SECCIONES;
const GUARDADO = { nombre: 'Ana Rivas', frase: 'Cada proceso parte por entender qué te trae.', sobre: 'Psicóloga clínica, adultos.' };

export function MuestrarioEstilo() {
  const [pestana, setPestana] = useState<'a' | 'b' | 'c'>('a');
  const [aviso, setAviso] = useState(true);

  const [base, setBase] = useState(GUARDADO);
  const [draft, setDraft] = useState(GUARDADO);
  const [sel, setSel] = useState<Seccion | null>(null);
  const sucio = JSON.stringify(draft) !== JSON.stringify(base);
  const guarda = useGuardaCambios(sucio);
  const descartarY = (luego: () => void) =>
    guarda.confirmar(() => {
      setDraft(base);
      luego();
    });
  const elegir = (s: Seccion) => sel !== s && descartarY(() => setSel(s));

  return (
    <main className="trama min-h-dvh px-4 py-8 text-tinta">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-8">
        <BarraFlotante etiqueta="Muestrario" variante="moderno">
          <strong className="text-[15px] font-black">Moderno A</strong>
          <Badge tono={sucio ? 'pendiente' : 'positivo'}>{sucio ? 'Cambios sin publicar' : 'Publicado'}</Badge>
          <SeparadorBarra />
          <Pestanas
            sinFondo
            etiqueta="Secciones de ejemplo"
            tono="moderno"
            valor={pestana}
            onChange={setPestana}
            pestanas={[
              { valor: 'a', etiqueta: 'Integrantes' },
              { valor: 'b', etiqueta: 'Practicantes', n: 2 },
              { valor: 'c', etiqueta: 'Reseñas' },
            ]}
          />
        </BarraFlotante>

        <Card variante="crema" aria-labelledby="m-color">
          <h2 id="m-color" className="m-0 mb-4 text-[20px] font-black">
            Tokens
          </h2>
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3 p-0">
            {COLORES.map(([n, c, hex]) => (
              <li key={n} className="flex flex-col gap-1.5 text-[12.5px] font-bold">
                <span className={`h-14 rounded-campo border border-borde ${c}`} />
                {n} <span className="font-semibold text-neutral-800">{hex}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3 text-[12.5px] font-bold">
            {(['rounded-campo 14', 'rounded-tarjeta 16', 'rounded-panel 24', 'rounded-full 999'] as const).map((r) => (
              <span key={r} className={`border-[1.5px] border-tinta px-4 py-3 ${r.split(' ')[0]}`}>
                {r}
              </span>
            ))}
            <span className="rounded-tarjeta bg-papel px-4 py-3 shadow-suave">shadow-suave</span>
            <span className="rounded-tarjeta bg-papel px-4 py-3 shadow-flotante">shadow-flotante</span>
          </div>
        </Card>

        <div className="grid gap-5 md:grid-cols-2">
          <Card variante="crema">
            <h2 className="m-0 mb-1 text-[18px] font-black">Superficie crema</h2>
            <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Tarjeta sobre el lienzo.</p>
          </Card>
          <Card variante="translucida">
            <h2 className="m-0 mb-1 text-[18px] font-black">Superficie translúcida</h2>
            <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Crema al 92 % con blur (inspector).</p>
          </Card>
        </div>

        <Card variante="crema" aria-labelledby="m-ctl">
          <h2 id="m-ctl" className="m-0 mb-4 text-[20px] font-black">
            Controles
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Sin cambios">{(x) => <Input {...x} defaultValue="Ana Rivas" />}</Field>
            <Field label="Con cambios" cambiado hint="Borde arcilla y marca «Modificado».">
              {(x) => <Input {...x} defaultValue="Ana Rivas Soto" />}
            </Field>
            <Interruptor etiqueta="Avisarme por correo" descripcion="Interruptor con rol switch." activo={aviso} onChange={setAviso} tono="team" />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tono="positivo">Publicado</Badge>
              <Badge tono="pendiente">Cambios sin publicar</Badge>
              <Badge tono="atencion">Por validar</Badge>
              <Badge tono="neutro">Baja</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="team">Guardar</Button>
              <Button variant="primary">Acción del paciente</Button>
              <Button variant="secondary">Secundario</Button>
              <Button variant="ghost">Fantasma</Button>
            </div>
          </div>
        </Card>

        <Card variante="crema" aria-labelledby="m-ed">
          <h2 id="m-ed" className="m-0 mb-1 text-[20px] font-black">
            Editor enfocado
          </h2>
          <p className="m-0 mb-4 text-[13.5px] font-semibold text-neutral-800">
            Elige una sección y cámbiala. Clic fuera, Escape, otra sección o{' '}
            <Link href="/" className="font-extrabold underline">
              este enlace
            </Link>{' '}
            piden confirmar si hay cambios.
          </p>
          <div className="flex flex-wrap items-start gap-5">
            <div className="min-w-0 flex-[2_1_380px]">
              <EditorEnfocado activa={!!sel} onQuitar={() => descartarY(() => setSel(null))}>
                {(Object.keys(SECCIONES) as Seccion[]).map((s) => (
                  <SeccionEnfocable key={s} etiqueta={SECCIONES[s]} activa={sel === s} atenuada={!!sel && sel !== s} onElegir={() => elegir(s)}>
                    {s === 'cab' ? (
                      <>
                        <strong className="block text-[22px] font-black">{draft.nombre}</strong>
                        <span className="text-[14px] font-semibold text-neutral-800">{draft.frase}</span>
                      </>
                    ) : (
                      <p className="m-0 text-[14px] font-semibold">{draft.sobre}</p>
                    )}
                  </SeccionEnfocable>
                ))}
              </EditorEnfocado>
            </div>
            <Card variante="translucida" className="flex min-w-0 flex-[1_1_280px] flex-col gap-3" aria-label="Inspector">
              {!sel ? (
                <p className="m-0 text-[13.5px] font-semibold text-neutral-800">Elige una sección para editarla.</p>
              ) : sel === 'cab' ? (
                <>
                  <Field label="Nombre" cambiado={draft.nombre !== base.nombre}>
                    {(x) => <Input {...x} value={draft.nombre} onChange={(e) => setDraft({ ...draft, nombre: e.target.value })} />}
                  </Field>
                  <Field label="Frase destacada" cambiado={draft.frase !== base.frase}>
                    {(x) => <Input {...x} value={draft.frase} onChange={(e) => setDraft({ ...draft, frase: e.target.value })} />}
                  </Field>
                </>
              ) : (
                <Field label="Sobre mí" cambiado={draft.sobre !== base.sobre}>
                  {(x) => <Textarea {...x} value={draft.sobre} onChange={(e) => setDraft({ ...draft, sobre: e.target.value })} />}
                </Field>
              )}
            </Card>
          </div>
        </Card>

        <BarraSinGuardar
          visible={sucio}
          onDescartar={() => setDraft(base)}
          onGuardar={() => {
            setBase(draft);
            setSel(null);
          }}
        />
      </div>
      <DialogoDescartar seccion={sel ? SECCIONES[sel] : 'el perfil'} {...guarda.dialogo} />
    </main>
  );
}
