'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';

import { AvatarProfesional } from '@/components/shared/AvatarProfesional';
import { PasoPago } from '@/components/shared/PasoPago';
import { Aviso } from '@/components/ui/Aviso';
import { Button } from '@/components/ui/Button';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { Casilla } from '@/components/ui/Casilla';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import type { components } from '@/lib/api/esquema';
import { ApiError } from '@/lib/api/errores';
import { condicionesAgendamiento, edadEn } from '@/lib/condiciones';
import { formatoClp, formatoFechaLarga, formatoHora, rutValido } from '@/lib/formato';
import type { Bloque } from '@/lib/horarios';
import { olvidarMatch, ultimoMatch } from '@/lib/match-memoria';
import type { Icono } from '@/lib/iconos';
import { caminoReserva, useEstadoPago, type CaminoPago, type EstadoConfirmacion } from '@/lib/pagos';
import { nombreCorto, nombrePerfil } from '@/lib/perfiles';

import { CuentaRegresiva } from './CuentaRegresiva';
import { NOMBRE_MODALIDAD_CITA, SelectorHorario } from './SelectorHorario';
import { CampoRut, rutNormalizado } from '@/components/shared/CampoRut';
import { FechaNacimiento } from '@/components/shared/FechaNacimiento';

type Centro = components['schemas']['CentroPublico'];
type Perfil = components['schemas']['PerfilPublico'];
type Politica = { id: string; version: number };

const PASOS = ['Horario', 'Tus datos', 'Pago', 'Confirmada'] as const;
const TELEFONO = /^\+56\d{9}$/;

interface Datos {
  nombre: string;
  apellido: string;
  fechaNacimiento: string;
  email: string;
  telefono: string;
  rut: string;
  paraMenor: boolean;
  adultoNombre: string;
  adultoParentesco: string;
  adultoTelefono: string;
  aceptaDatos: boolean;
  aceptaTerminos: boolean;
  sitioWeb: string;
}

const VACIO: Datos = {
  nombre: '',
  apellido: '',
  fechaNacimiento: '',
  email: '',
  telefono: '',
  rut: '',
  paraMenor: false,
  adultoNombre: '',
  adultoParentesco: '',
  adultoTelefono: '',
  aceptaDatos: false,
  aceptaTerminos: false,
  sitioWeb: '',
};

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MENSAJE_CORREO = 'Escribe un correo válido: ahí llegan la confirmación y la invitación a tu cuenta.';

/** Tarifa aplicable a la modalidad elegida (la mas especifica sin tipo de atencion). */
const tarifaPara = (p: Perfil, m: Bloque['modalidad']) =>
  (p.tarifas.find((t) => !t.tipo_atencion && t.modalidad === m) ?? p.tarifas.find((t) => !t.tipo_atencion && !t.modalidad))?.monto ?? null;

/**
 * Pedir hora sin cuenta (D-2, D-3): horario, datos de contacto con la
 * politica de datos y, con la hora retenida (03b-3.2: cuenta regresiva), el
 * pago con los medios del centro. El pago validado confirma la hora y crea al
 * paciente (la invitacion a la cuenta llega al correo); con pago en el centro
 * el gatillo es el enlace del correo. La pestaña consulta el estado de la
 * reserva (token opaco en memoria) cada pocos segundos mientras esta visible
 * y avanza sola, tambien si el correo se abre en otro dispositivo. El
 * vencimiento lo decide el servidor: al llegar a cero, la cuenta regresiva
 * solo pide el estado.
 */
export function SolicitudHora({
  perfil,
  centro,
  politicaDatos,
  terminos,
}: {
  perfil: Perfil;
  centro: Centro;
  politicaDatos: Politica;
  terminos: Politica | null;
}) {
  const [paso, setPaso] = useState(0);
  const [bloque, setBloque] = useState<Bloque | null>(null);
  const [d, setD] = useState<Datos>(VACIO);
  const [errores, setErrores] = useState<Partial<Record<keyof Datos, string>>>({});
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const [retencion, setRetencion] = useState<{ desde: Date; hasta: Date } | null>(null);
  const [reserva, setReserva] = useState<string | null>(null);
  const camino = useMemo(() => (reserva ? caminoReserva(reserva) : null), [reserva]);
  const consulta = useEstadoPago(paso >= 2 ? camino : null);
  const estadoReserva = consulta.data;
  const titulo = useRef<HTMLHeadingElement>(null);
  const alerta = useRef<HTMLParagraphElement>(null);
  const montado = useRef(false);
  const cliente = useQueryClient();

  const edad = bloque && /^\d{4}-\d{2}-\d{2}$/.test(d.fechaNacimiento) ? edadEn(d.fechaNacimiento, bloque.inicio) : null;
  const menor = d.paraMenor || (edad !== null && edad < 18);
  const cambiar = <K extends keyof Datos>(k: K, v: Datos[K]) => {
    setD((a) => ({ ...a, [k]: v }));
    // El error de un campo se vuelve a revisar al salir de el (03b-4.1), no al final.
    if (errores[k]) setErrores((e) => ({ ...e, [k]: undefined }));
  };
  const alSalir = (k: 'email' | 'telefono' | 'adultoTelefono') => () => {
    const v = d[k].trim();
    const malo = k === 'email' ? v !== '' && !CORREO.test(v) : v !== '' && !TELEFONO.test(v.replace(/\s/g, ''));
    if (malo) setErrores((e) => ({ ...e, [k]: k === 'email' ? MENSAJE_CORREO : 'Formato +56 9 1234 5678.' }));
  };

  useEffect(() => {
    if (montado.current) titulo.current?.focus();
    montado.current = true;
  }, [paso]);
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);

  const validar = (): boolean => {
    const e: typeof errores = {};
    if (!d.nombre.trim()) e.nombre = 'Escribe el nombre del paciente.';
    if (!d.apellido.trim()) e.apellido = 'Escribe el apellido del paciente.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fechaNacimiento) || new Date(d.fechaNacimiento) > new Date())
      e.fechaNacimiento = 'Indica una fecha de nacimiento válida.';
    if (!CORREO.test(d.email.trim())) e.email = MENSAJE_CORREO;
    if (d.telefono && !TELEFONO.test(d.telefono.replace(/\s/g, ''))) e.telefono = 'Formato +56 9 1234 5678.';
    if (d.rut && !rutValido(d.rut)) e.rut = 'El RUT no es válido. Revisa el dígito verificador.';
    if (menor) {
      if (!d.adultoNombre.trim()) e.adultoNombre = 'Falta el nombre del adulto responsable.';
      if (!d.adultoParentesco.trim()) e.adultoParentesco = 'Indica la relación con el paciente.';
      if (d.adultoTelefono && !TELEFONO.test(d.adultoTelefono.replace(/\s/g, ''))) e.adultoTelefono = 'Formato +56 9 1234 5678.';
    }
    if (!d.aceptaDatos) e.aceptaDatos = 'Para pedir hora debes aceptar la política de datos.';
    if (terminos && !d.aceptaTerminos) e.aceptaTerminos = 'Debes aceptar los términos de agendamiento.';
    setErrores(e);
    return Object.keys(e).length === 0;
  };

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!bloque) return;
    if (!validar()) {
      setError('Revisa los campos marcados.');
      return;
    }
    setEnviando(true);
    setError(undefined);
    const match = ultimoMatch();
    const opcional = (v: string) => (v.trim() ? v.replace(/\s/g, '') : undefined);
    try {
      const r = await datos(
        api.POST('/api/publico/solicitudes', {
          body: {
            profesionalId: perfil.id,
            modalidad: bloque.modalidad,
            inicio: bloque.inicio.toISOString(),
            fin: bloque.fin.toISOString(),
            nombre: d.nombre.trim(),
            apellido: d.apellido.trim(),
            fechaNacimiento: d.fechaNacimiento,
            email: d.email.trim(),
            telefono: opcional(d.telefono),
            rut: rutNormalizado(d.rut) || undefined,
            ...(menor ? { adultoNombre: d.adultoNombre.trim(), adultoParentesco: d.adultoParentesco.trim(), adultoTelefono: opcional(d.adultoTelefono) } : {}),
            ...(match ? { respuestas: match.respuestas, recomendadoId: match.recomendadoId ?? undefined } : {}),
            politicaId: politicaDatos.id,
            terminosId: terminos?.id,
            sitioWeb: d.sitioWeb || undefined,
          },
        }),
      );
      olvidarMatch();
      setRetencion({ desde: new Date(), hasta: new Date(r.expiraEn) });
      setReserva(r.reserva);
      setPaso(2);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // La hora se tomo o no hay box: se refresca la grilla y se vuelve a elegir.
        void cliente.invalidateQueries({ queryKey: ['disponibilidad-publica', perfil.id] });
        setBloque(null);
        setPaso(0);
      }
      setError(e instanceof ApiError ? e.message : 'No pudimos enviar la solicitud. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  // Manda el servidor: al llegar a cero se consulta el estado antes de mostrar "hora liberada".
  const { refetch } = consulta;
  const alVencer = useCallback(() => void refetch(), [refetch]);
  const otraHora = (b: Bloque) => {
    void cliente.invalidateQueries({ queryKey: ['disponibilidad-publica', perfil.id] });
    setBloque(b);
    setRetencion(null);
    setReserva(null);
    setPaso(1);
  };
  const pasoVisible = paso === 2 && estadoReserva?.estado === 'CONFIRMADA' ? 3 : paso;

  const tarifa = bloque ? tarifaPara(perfil, bloque.modalidad) : null;

  return (
    <div className="grid items-start gap-[clamp(20px,3vw,36px)] pt-[clamp(10px,2vw,24px)] lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0">
        <ol className="m-0 mb-[26px] flex list-none gap-2.5 p-0" aria-label="Pasos">
          {PASOS.map((p, i) => (
            <li key={p} aria-current={i === pasoVisible ? 'step' : undefined} className="flex flex-1 flex-col gap-2">
              <span className={`block h-[5px] rounded-full transition-colors duration-300 ${i <= pasoVisible ? 'bg-accent-2-600' : 'bg-neutral-300'}`} />
              <span className={`text-[11.5px] font-extrabold tracking-[0.06em] uppercase ${i === pasoVisible ? 'text-accent-2-800' : 'text-neutral-700'}`}>
                {p}
              </span>
            </li>
          ))}
        </ol>

        {error && (
          <p
            ref={alerta}
            tabIndex={-1}
            role="alert"
            className="m-0 mb-5 flex gap-2.5 rounded-[18px] border border-accent-500 bg-accent-200 px-[17px] py-[15px] text-sm font-bold text-accent-900 outline-none"
          >
            <Icon name="error" size={19} />
            {error}
          </p>
        )}

        {paso === 0 && (
          <section className="entrada">
            <h1
              ref={titulo}
              tabIndex={-1}
              className="m-0 mb-2.5 text-[clamp(28px,3.6vw,40px)] leading-[1.02] font-black tracking-[-0.035em] text-balance outline-none"
            >
              Elige el horario de tu sesión
            </h1>
            <p className="m-0 mb-6 max-w-[56ch] text-base leading-relaxed text-pretty text-neutral-700">
              Estas son las horas libres de {nombreCorto(perfil)}. Al enviar tus datos, te guardamos la hora unos minutos mientras pagas.
            </p>
            <div className="rounded-lg border border-divider bg-neutral-100 p-[clamp(18px,3vw,28px)] shadow-sm">
              <SelectorHorario
                profesionalId={perfil.id}
                valor={bloque}
                onElegir={(b) => {
                  setBloque(b);
                  setError(undefined);
                }}
                sinHoras={<SinHoras perfil={perfil} centro={centro} />}
              />
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Button variant="team" size="lg" disabled={!bloque} onClick={() => setPaso(1)}>
                Continuar
                <Icon name="arrow_forward" size={19} />
              </Button>
              <span className="text-[13.5px] font-semibold text-neutral-700" aria-live="polite">
                {bloque ? `${formatoFechaLarga(bloque.inicio)}, ${formatoHora(bloque.inicio)}` : 'Elige una hora para continuar.'}
              </span>
            </div>
          </section>
        )}

        {paso === 1 && bloque && (
          <form className="entrada flex flex-col gap-4" onSubmit={(e) => void enviar(e)} noValidate>
            <h1
              ref={titulo}
              tabIndex={-1}
              className="m-0 text-[clamp(28px,3.6vw,40px)] leading-[1.02] font-black tracking-[-0.035em] text-balance outline-none"
            >
              Datos del paciente
            </h1>
            <p className="m-0 max-w-[56ch] text-base leading-relaxed text-pretty text-neutral-700">
              Con el pago confirmamos tu hora y te enviamos al correo la confirmación y la invitación para crear tu cuenta.
            </p>

            <fieldset className="m-0 grid gap-4 rounded-lg border border-divider bg-neutral-100 p-[clamp(18px,3vw,28px)] shadow-sm sm:grid-cols-2">
              <legend className="sr-only">Datos del paciente</legend>
              <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-bold sm:col-span-2">
                <input
                  type="checkbox"
                  checked={d.paraMenor}
                  onChange={(e) => cambiar('paraMenor', e.target.checked)}
                  className="size-[18px] cursor-pointer accent-accent-2-600"
                />
                Pido hora para un menor de edad
              </label>
              <Field label="Nombre" required error={errores.nombre}>
                {(p) => <Input {...p} autoComplete={d.paraMenor ? 'off' : 'given-name'} value={d.nombre} onChange={(e) => cambiar('nombre', e.target.value)} />}
              </Field>
              <Field label="Apellido" required error={errores.apellido}>
                {(p) => (
                  <Input {...p} autoComplete={d.paraMenor ? 'off' : 'family-name'} value={d.apellido} onChange={(e) => cambiar('apellido', e.target.value)} />
                )}
              </Field>
              <FechaNacimiento
                label="Fecha de nacimiento"
                required
                error={errores.fechaNacimiento}
                value={d.fechaNacimiento}
                onChange={(v) => cambiar('fechaNacimiento', v)}
                avisoMenor={d.paraMenor ? undefined : 'Es menor de 18 años: más abajo te pediremos los datos de su adulto responsable.'}
              />
              <CampoRut
                label="RUT"
                hint="Opcional. Lo pedimos en la primera sesión si no lo tienes a mano."
                error={errores.rut}
                value={d.rut}
                onChange={(v) => cambiar('rut', v)}
              />
              <Field label={menor ? 'Correo del adulto responsable' : 'Correo'} required error={errores.email}>
                {(p) => (
                  <Input
                    {...p}
                    type="email"
                    autoComplete="email"
                    value={d.email}
                    onChange={(e) => cambiar('email', e.target.value)}
                    onBlur={alSalir('email')}
                  />
                )}
              </Field>
              <Field label="Teléfono" hint="Opcional." error={errores.telefono}>
                {(p) => (
                  <Input
                    {...p}
                    type="tel"
                    autoComplete="tel"
                    placeholder="+56 9 1234 5678"
                    value={d.telefono}
                    onChange={(e) => cambiar('telefono', e.target.value)}
                    onBlur={alSalir('telefono')}
                  />
                )}
              </Field>
              <p className="m-0 flex items-center gap-[7px] text-[12.5px] font-semibold text-neutral-700 sm:col-span-2">
                <Icon name="lock" size={16} />
                Tus datos viajan cifrados y se usan solo para tu atención en el centro.
              </p>
            </fieldset>

            {menor && (
              <fieldset className="entrada m-0 grid gap-4 rounded-lg border border-accent-500 bg-accent-200 p-[clamp(18px,3vw,28px)] sm:grid-cols-2">
                <legend className="float-left mb-1 flex w-full items-center gap-2.5 text-[19px] font-black tracking-[-0.025em] text-accent-900">
                  <Icon name="family_restroom" size={22} className="text-accent-700" />
                  Adulto responsable
                </legend>
                <p className="m-0 text-sm font-bold text-pretty text-accent-900 sm:col-span-2">
                  {edad !== null && edad < 18 && !d.paraMenor ? 'Por la fecha de nacimiento, el paciente es menor de 18. ' : ''}
                  Quien pide la hora se declara adulto responsable y debe estar en la primera sesión.
                </p>
                <Field label="Nombre completo" required error={errores.adultoNombre}>
                  {(p) => <Input {...p} autoComplete="name" value={d.adultoNombre} onChange={(e) => cambiar('adultoNombre', e.target.value)} />}
                </Field>
                <Field label="Relación con el paciente" required error={errores.adultoParentesco}>
                  {(p) => (
                    <Input {...p} placeholder="Madre, padre, tutor…" value={d.adultoParentesco} onChange={(e) => cambiar('adultoParentesco', e.target.value)} />
                  )}
                </Field>
                <Field label="Teléfono del adulto" hint="Opcional." error={errores.adultoTelefono}>
                  {(p) => (
                    <Input
                      {...p}
                      type="tel"
                      placeholder="+56 9 1234 5678"
                      value={d.adultoTelefono}
                      onChange={(e) => cambiar('adultoTelefono', e.target.value)}
                      onBlur={alSalir('adultoTelefono')}
                    />
                  )}
                </Field>
              </fieldset>
            )}

            <section className="rounded-lg border border-divider bg-neutral-100 p-[clamp(18px,3vw,28px)] shadow-sm">
              <h2 className="m-0 mb-3.5 text-[19px] font-black tracking-[-0.025em]">Condiciones de agendamiento</h2>
              <ul className="m-0 mb-[18px] flex flex-col gap-2 pl-5">
                {condicionesAgendamiento(centro, menor).map((c) => (
                  <li key={c} className="text-sm leading-[1.55] font-semibold text-pretty text-neutral-800">
                    {c}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2.5">
                <Casilla checked={d.aceptaDatos} onChange={(v) => cambiar('aceptaDatos', v)} error={errores.aceptaDatos}>
                  Leí y acepto la{' '}
                  <Link href="/politicas/POLITICA_DATOS" target="_blank" className="font-extrabold underline underline-offset-2">
                    política de datos personales
                  </Link>{' '}
                  (versión {politicaDatos.version}).
                </Casilla>
                {terminos && (
                  <Casilla checked={d.aceptaTerminos} onChange={(v) => cambiar('aceptaTerminos', v)} error={errores.aceptaTerminos}>
                    Acepto los{' '}
                    <Link href="/politicas/TERMINOS_AGENDAMIENTO" target="_blank" className="font-extrabold underline underline-offset-2">
                      términos de agendamiento y cancelación
                    </Link>{' '}
                    (versión {terminos.version}).
                  </Casilla>
                )}
              </div>
            </section>

            {/* Trampa para bots: invisible para personas y lectores de pantalla. */}
            <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
              <label>
                Sitio web
                <input tabIndex={-1} autoComplete="off" value={d.sitioWeb} onChange={(e) => cambiar('sitioWeb', e.target.value)} />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="team" size="lg" icon="arrow_forward" loading={enviando}>
                Reservar mi hora
              </Button>
              <Button variant="ghost" icon="arrow_back" onClick={() => setPaso(0)}>
                Cambiar el horario
              </Button>
            </div>
          </form>
        )}

        {paso === 2 && bloque && retencion && camino && (
          <ResultadoReserva
            estado={estadoReserva}
            camino={camino}
            perfil={perfil}
            centro={centro}
            email={d.email.trim()}
            desde={retencion.desde}
            titulo={titulo}
            onVencida={alVencer}
            onOtraHora={otraHora}
          />
        )}
      </div>

      <aside className="flex flex-col gap-4 rounded-lg border border-accent-2-500 bg-accent-2-200 p-6 shadow-sm lg:sticky lg:top-6">
        <div className="flex items-center gap-3.5">
          <AvatarProfesional nombre={nombrePerfil(perfil)} foto={perfil.foto_url} size={56} />
          <div className="min-w-0">
            <div className="text-lg font-black tracking-[-0.025em] text-accent-2-900">{nombrePerfil(perfil)}</div>
            <div className="text-[13px] font-bold text-accent-2-800">{perfil.especialidad}</div>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-4 rounded-[18px] border border-accent-2-500 bg-bg p-[18px]">
          <div className="col-span-2">
            <dt className="mb-1.5 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">Hora elegida</dt>
            <dd className="m-0 text-[17px] font-black tracking-[-0.02em]">
              {bloque ? `${formatoFechaLarga(bloque.inicio)}, ${formatoHora(bloque.inicio)}` : 'Sin elegir'}
            </dd>
          </div>
          {bloque && (
            <div>
              <dt className="mb-1.5 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">Modalidad</dt>
              <dd className="m-0 flex items-center gap-1.5 text-sm font-extrabold">
                <Icon name={bloque.modalidad === 'ONLINE' ? 'videocam' : 'meeting_room'} size={17} className="text-accent-2-700" />
                {NOMBRE_MODALIDAD_CITA[bloque.modalidad]}
              </dd>
            </div>
          )}
          {tarifa !== null && (
            <div>
              <dt className="mb-1.5 text-[11px] font-extrabold tracking-[0.08em] text-neutral-700 uppercase">Valor</dt>
              <dd className="m-0 text-sm font-extrabold">{formatoClp(tarifa)}</dd>
            </div>
          )}
        </dl>
        {perfil.boleta_reembolsable && (
          <p className="m-0 flex items-center gap-2 text-[13px] font-bold text-accent-2-900">
            <Icon name="receipt_long" size={17} />
            Emite boleta reembolsable en isapre.
          </p>
        )}
      </aside>
    </div>
  );
}

/**
 * Con la hora retenida: el paso de pago (o "revisa tu correo" si se paga en el
 * centro) con la cuenta regresiva, y la pantalla final: confirmada, liberada
 * (con las horas libres para elegir otra; los datos del formulario se
 * conservan) o pagada cuando la hora ya no estaba (devolucion).
 */
function ResultadoReserva({
  estado,
  camino,
  perfil,
  centro,
  email,
  desde,
  titulo,
  onVencida,
  onOtraHora,
}: {
  estado: EstadoConfirmacion | undefined;
  camino: CaminoPago;
  perfil: Perfil;
  centro: Centro;
  email: string;
  desde: Date;
  titulo: RefObject<HTMLHeadingElement | null>;
  onVencida: () => void;
  onOtraHora: (b: Bloque) => void;
}) {
  const [otra, setOtra] = useState<Bloque | null>(null);
  const encabezado = (icono: Icono, texto: string) => (
    <>
      <span className="grid size-[60px] place-items-center rounded-full border border-accent-2-500 bg-accent-2-200">
        <Icon name={icono} size={30} className="text-accent-2-700" />
      </span>
      <h1 ref={titulo} tabIndex={-1} className="m-0 text-[clamp(28px,3.6vw,40px)] leading-[1.02] font-black tracking-[-0.035em] text-balance outline-none">
        {texto}
      </h1>
    </>
  );
  const parrafo = (texto: string) => <p className="m-0 max-w-[56ch] text-base leading-relaxed text-pretty text-neutral-700">{texto}</p>;

  if (!estado) {
    return (
      <p className="m-0 text-[14px] font-bold text-neutral-700" aria-live="polite">
        Reservando tu hora…
      </p>
    );
  }
  if (estado.estado === 'RETENIDA') {
    const correo = estado.siguiente === 'VERIFICAR_CORREO';
    return (
      <section className="entrada flex flex-col gap-5" aria-live="polite">
        {encabezado(correo ? 'mark_email_read' : 'payments', correo ? 'Revisa tu correo' : 'Paga para confirmar tu hora')}
        {correo &&
          parrafo(
            `Enviamos un enlace a ${email}. Ábrelo antes de que termine el tiempo: la hora queda reservada a tu nombre y pagas al llegar a tu sesión. Si no lo ves, revisa la carpeta de spam. Puedes abrirlo en este u otro dispositivo: esta pantalla avanza sola.`,
          )}
        {estado.venceEn && !estado.comprobanteRecibido && (
          <div className="rounded-lg border border-divider bg-neutral-100 p-6 shadow-sm">
            <CuentaRegresiva desde={desde} hasta={new Date(estado.venceEn)} onVencida={onVencida} />
          </div>
        )}
        <PasoPago camino={camino} estado={estado} />
      </section>
    );
  }
  if (estado.estado === 'CONFIRMADA') {
    return (
      <section className="entrada flex flex-col gap-5" aria-live="polite">
        {encabezado('check_circle', 'Tu hora quedó confirmada')}
        {parrafo('Te enviamos la confirmación por correo. Si eres paciente nuevo, ahí también llega la invitación para crear tu cuenta.')}
        {estado.medio === 'PAGO_EN_CENTRO' && (
          <Aviso tono="exito" icono="storefront" titulo="Pagas al llegar">
            El pago se hace en el centro, el día de tu sesión.
          </Aviso>
        )}
      </section>
    );
  }
  if (estado.siguiente === 'CONTACTAR_CENTRO') {
    return (
      <section className="entrada flex flex-col gap-5" aria-live="polite">
        {encabezado('info', 'Recibimos tu pago, pero la hora ya no estaba')}
        {parrafo(
          `El pago llegó después de que venciera el plazo para pagar y otra persona tomó la hora. El centro te contactará para devolverlo${
            centro.contacto_correo ? `; también puedes escribir a ${centro.contacto_correo}` : ''
          }.`,
        )}
      </section>
    );
  }
  return (
    <section className="entrada flex flex-col gap-5" aria-live="polite">
      {encabezado('event_busy', 'La hora se liberó')}
      {parrafo(
        estado.estado === 'LIBERADA'
          ? 'Venció el plazo y la hora quedó disponible para otras personas. Elige otra hora: tus datos se conservan.'
          : 'Esta hora ya no está vigente. Elige otra hora: tus datos se conservan.',
      )}
      <div className="rounded-lg border border-divider bg-neutral-100 p-[clamp(18px,3vw,28px)] shadow-sm">
        <SelectorHorario profesionalId={perfil.id} valor={otra} onElegir={setOtra} sinHoras={<SinHoras perfil={perfil} centro={centro} />} />
      </div>
      <div>
        <Button variant="team" size="lg" icon="arrow_forward" disabled={!otra} onClick={() => otra && onOtraHora(otra)}>
          Continuar con esta hora
        </Button>
      </div>
    </section>
  );
}

/** Sin horas en la ventana: ver otros profesionales o entrar a la cuenta. */
function SinHoras({ perfil, centro }: { perfil: Perfil; centro: Centro }) {
  return (
    <div className="flex flex-col items-start gap-4 py-4">
      <Icon name="event_busy" size={28} className="text-neutral-500" />
      <div>
        <p className="m-0 mb-1 text-base font-extrabold">{nombreCorto(perfil)} no tiene horas libres en las próximas semanas.</p>
        <p className="m-0 max-w-[56ch] text-[13.5px] font-semibold text-pretty text-neutral-800">
          Vuelve a revisar más adelante o mira otros profesionales del centro.
          {centro.contacto_correo && ` También puedes escribir a ${centro.contacto_correo}.`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <ButtonLink href="/equipo" variant="secondary" icon="group">
          Ver otros profesionales
        </ButtonLink>
        <ButtonLink href="/ingreso?volver=%2Fportal" variant="ghost" icon="login">
          Ya soy paciente: entrar a mi cuenta
        </ButtonLink>
      </div>
    </div>
  );
}
