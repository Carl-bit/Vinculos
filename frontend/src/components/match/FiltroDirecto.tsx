'use client';

import { useState, type FormEvent } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { ControlSegmentado } from '@/components/ui/ControlSegmentado';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { formatoClp, formatoFechaLarga } from '@/lib/formato';
import { usePerfilesPublicos } from '@/lib/panel';
import { nombreCorto, nombrePerfil, tiposDeAtencion } from '@/lib/perfiles';

type Resultado = components['schemas']['ResultadoMatchDirecto'];
type Modalidad = 'PRESENCIAL' | 'ONLINE' | '';

const PLAZOS = [
  { value: '7', label: 'Esta semana' },
  { value: '14', label: 'Próximas dos semanas' },
  { value: '30', label: 'Este mes' },
] as const;

/**
 * "Prefiero filtrar yo mismo" (lo habilita ADMIN en Match): sin cuestionario,
 * el paciente elige tipo de atencion, modalidad, plazo y precio maximo. La API
 * ordena por necesidad > tiempos > precio y marca lo que no cumple. No se
 * guarda nada.
 */
export function FiltroDirecto({ agenda, onVolver }: { agenda: boolean; onVolver: () => void }) {
  const perfiles = usePerfilesPublicos();
  const tipos = tiposDeAtencion(perfiles.data ?? []);
  const [tipo, setTipo] = useState('');
  const [modalidad, setModalidad] = useState<Modalidad>('');
  const [plazo, setPlazo] = useState('14');
  const [maximo, setMaximo] = useState('');
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string>();

  const buscar = async (e: FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError(undefined);
    const desde = new Date();
    const hasta = new Date(desde.getTime() + Number(plazo) * 86_400_000);
    try {
      setResultados(
        await datos(
          api.GET('/api/publico/match', {
            params: {
              query: {
                tipoAtencion: tipo || undefined,
                modalidad: modalidad || undefined,
                desde: desde.toISOString(),
                hasta: hasta.toISOString(),
                tarifaMaxima: maximo ? Number(maximo) : undefined,
              },
            },
          }),
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No pudimos buscar. Intenta de nuevo.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="entrada flex flex-col gap-6">
      <div>
        <h1 className="m-0 mb-2.5 text-[clamp(25px,3.2vw,36px)] leading-[1.08] font-black tracking-[-0.035em] text-balance">Filtra el equipo a tu manera</h1>
        <p className="m-0 max-w-[56ch] text-[15.5px] leading-relaxed font-medium text-pretty text-neutral-800">
          Primero lo que necesitas, después cuándo puedes y el precio. No guardamos tu búsqueda.
        </p>
      </div>
      <form onSubmit={(e) => void buscar(e)} noValidate className="flex flex-col gap-5">
        <Field label="Tipo de atención">
          {(p) => (
            <Select {...p} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Cualquiera</option>
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ControlSegmentado
          etiqueta="Modalidad"
          conLeyenda
          valor={modalidad || 'cualquiera'}
          onChange={(v) => setModalidad(v === 'cualquiera' ? '' : v)}
          opciones={[
            { valor: 'cualquiera', etiqueta: 'Me da igual', icono: 'swap_horiz' },
            { valor: 'PRESENCIAL', etiqueta: 'Presencial', icono: 'meeting_room' },
            { valor: 'ONLINE', etiqueta: 'Online', icono: 'videocam' },
          ]}
        />
        <ChoiceGroup legend="¿Para cuándo?" type="radio" value={[plazo]} onChange={(v) => setPlazo(v[0] ?? '14')} options={PLAZOS} />
        <Field label="Precio máximo por sesión (opcional)" hint="En pesos chilenos.">
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="Ej.: 35000"
              value={maximo}
              onChange={(e) => setMaximo(e.target.value)}
              className="!max-w-[220px]"
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="m-0 text-sm font-bold text-accent-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" icon="arrow_back" onClick={onVolver}>
            Volver al cuestionario
          </Button>
          <Button type="submit" variant="team" size="lg" icon="search" loading={cargando}>
            Ver profesionales
          </Button>
        </div>
      </form>

      {resultados && (
        <section aria-label="Resultados" className="flex flex-col gap-5 border-t border-divider pt-6">
          {resultados.length === 0 ? (
            <p className="m-0 text-[15px] font-semibold text-neutral-800">Ningún profesional del equipo atiende ese tipo de atención con esa modalidad.</p>
          ) : (
            resultados.map((r) => (
              <article key={r.perfil.id} className="border-t border-divider pt-5 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-start gap-4">
                  <AvatarProfesional nombre={nombrePerfil(r.perfil)} foto={r.perfil.foto_url} size={56} />
                  <div className="min-w-[200px] flex-1">
                    <h2 className="m-0 text-lg leading-tight font-black tracking-[-0.02em]">{nombrePerfil(r.perfil)}</h2>
                    <p className="m-0 text-[14px] font-bold text-neutral-800">
                      {r.perfil.especialidad}
                      {r.tarifa !== null ? ` · ${formatoClp(r.tarifa)} la sesión` : ''}
                    </p>
                  </div>
                </div>
                <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0 text-[13.5px] font-bold">
                  <li className={`flex items-center gap-2 ${r.cumpleTiempos ? 'text-accent-2-800' : 'text-neutral-800'}`}>
                    <Icon name={r.cumpleTiempos ? 'event_available' : 'event_busy'} size={18} />
                    {r.primerHueco ? `Tiene horas desde el ${formatoFechaLarga(r.primerHueco)}` : 'Sin horas libres en ese plazo'}
                  </li>
                  {maximo && !r.cumplePrecio && (
                    <li className="flex items-center gap-2 text-neutral-800">
                      <Icon name="info" size={18} />
                      Su tarifa supera tu precio máximo
                    </li>
                  )}
                </ul>
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {agenda && (
                    <ButtonLink href={`/pedir-hora/${r.perfil.id}`} variant="team" icon="calendar_month">
                      Pedir hora con {nombreCorto(r.perfil)}
                    </ButtonLink>
                  )}
                  <ButtonLink href={`/equipo/${r.perfil.id}`} variant="secondary" icon="arrow_forward">
                    Ver perfil
                  </ButtonLink>
                </div>
              </article>
            ))
          )}
        </section>
      )}
    </div>
  );
}
