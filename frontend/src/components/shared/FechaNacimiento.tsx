'use client';

import { useId, useState, type ReactNode } from 'react';

import { Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { edadEn } from '@/lib/condiciones';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Años razonables: hasta 110 atras. */
const ANIOS_ATRAS = 110;

/** Dias del mes (mes 1-12), con bisiestos. */
export const diasDelMes = (anio: number, mes: number) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

const partes = (valor: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  return m ? { anio: m[1]!, mes: String(Number(m[2])), dia: String(Number(m[3])) } : { anio: '', mes: '', dia: '' };
};

interface Props {
  label: ReactNode;
  /** AAAA-MM-DD o '' mientras falte una parte. */
  value: string;
  onChange: (valor: string) => void;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Mensaje si la fecha da menos de 18 años (activa el flujo de adulto responsable). */
  avisoMenor?: ReactNode;
}

/**
 * Fecha de nacimiento con tres desplegables (03b-4.1): dia, mes y año. Los
 * dias siguen el mes y el año (bisiestos); si el dia elegido deja de existir
 * (31 -> febrero) se borra para que la persona lo vuelva a elegir.
 */
export function FechaNacimiento({ label, value, onChange, hint, error, required, avisoMenor }: Props) {
  const id = useId();
  const [p, setP] = useState(() => partes(value));
  // El padre puede reiniciar el valor (formulario limpio): se sincroniza sin efecto.
  const [previo, setPrevio] = useState(value);
  if (value !== previo) {
    setPrevio(value);
    if (value || p.anio || p.mes || p.dia) setP(value ? partes(value) : { anio: '', mes: '', dia: '' });
  }
  const anioActual = new Date().getFullYear();
  const max = p.anio && p.mes ? diasDelMes(Number(p.anio), Number(p.mes)) : 31;

  const cambiar = (campo: 'dia' | 'mes' | 'anio', v: string) => {
    const n = { ...p, [campo]: v };
    if (n.dia && n.anio && n.mes && Number(n.dia) > diasDelMes(Number(n.anio), Number(n.mes))) n.dia = '';
    setP(n);
    const completa = n.anio && n.mes && n.dia ? `${n.anio}-${n.mes.padStart(2, '0')}-${n.dia.padStart(2, '0')}` : '';
    setPrevio(completa);
    onChange(completa);
  };

  const menor = value && edadEn(value) < 18;
  const describedBy = [hint && `${id}-ayuda`, error && `${id}-error`, menor && avisoMenor && `${id}-menor`].filter(Boolean).join(' ') || undefined;
  const control = (campo: 'dia' | 'mes' | 'anio', etiqueta: string, opciones: { v: string; t: string }[], ancho: string) => (
    <label className={`flex min-w-0 flex-col gap-1 ${ancho}`}>
      <span className="text-[11.5px] font-bold text-neutral-800">{etiqueta}</span>
      <Select
        value={p[campo]}
        onChange={(e) => cambiar(campo, e.target.value)}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        required={required}
      >
        <option value="">{etiqueta}</option>
        {opciones.map((o) => (
          <option key={o.v} value={o.v}>
            {o.t}
          </option>
        ))}
      </Select>
    </label>
  );

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-[7px] border-0 p-0">
      <legend className="mb-[7px] p-0 text-[12.5px] font-extrabold">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </legend>
      <div className="flex flex-wrap gap-2.5">
        {control(
          'dia',
          'Día',
          Array.from({ length: max }, (_v, i) => ({ v: String(i + 1), t: String(i + 1) })),
          'w-[96px]',
        )}
        {control(
          'mes',
          'Mes',
          MESES.map((m, i) => ({ v: String(i + 1), t: m })),
          'min-w-[150px] flex-1',
        )}
        {control(
          'anio',
          'Año',
          Array.from({ length: ANIOS_ATRAS + 1 }, (_v, i) => ({ v: String(anioActual - i), t: String(anioActual - i) })),
          'w-[116px]',
        )}
      </div>
      {hint && (
        <span id={`${id}-ayuda`} className="text-[12.5px] font-semibold text-neutral-800">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} role="alert" className="text-[12.5px] font-bold text-accent-700">
          {error}
        </span>
      )}
      {menor && avisoMenor && (
        <p
          id={`${id}-menor`}
          role="status"
          className="m-0 flex gap-2 rounded-[14px] border border-accent-500 bg-accent-100 px-3.5 py-2.5 text-[13px] font-bold text-accent-900"
        >
          <Icon name="escalator_warning" size={18} />
          {avisoMenor}
        </p>
      )}
    </fieldset>
  );
}
