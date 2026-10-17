'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';
import { pareceRut, rutValido } from '@/lib/formato';
import { inicioDeRol, zonaDeRol } from '@/lib/roles';
import { iniciarSesion, verificarTotp, type DesafioTotp, type SesionActiva } from '@/lib/sesion';

type Perfil = 'paciente' | 'equipo';

const TEXTOS = {
  paciente: {
    eyebrow: 'Acceso de pacientes',
    titulo: 'Hola de nuevo.',
    bajada: 'Entra para ver tus horas agendadas, reagendar y revisar los datos de tu profesional.',
    usuario: 'Correo o RUT',
    ejemplo: 'tu@correo.cl o 12.345.678-9',
    boton: 'Entrar a mi cuenta',
  },
  equipo: {
    eyebrow: 'Acceso del equipo',
    titulo: 'Bienvenido de vuelta.',
    bajada: 'Ingresa con tu cuenta del centro para ver tu agenda, tus fichas y los módulos activos.',
    usuario: 'Correo del centro',
    ejemplo: 'nombre@centro.cl',
    boton: 'Entrar al panel',
  },
} as const;

/**
 * Login (diseño "Inicio de Sesion"): correo o RUT y contraseña; si la cuenta
 * tiene TOTP, segundo paso con el codigo. El perfil solo cambia textos: el
 * rol lo decide la API. Enlace por correo e invitacion: fase de portal.
 */
export function FormularioIngreso() {
  const router = useRouter();
  const parametros = useSearchParams();
  const volver = parametros.get('volver');
  const porInactividad = parametros.get('motivo') === 'inactividad';
  const [perfil, setPerfil] = useState<Perfil>('paciente');
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [desafio, setDesafio] = useState<DesafioTotp | null>(null);
  const [codigo, setCodigo] = useState('');
  const [secreto, setSecreto] = useState<string>();
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const t = TEXTOS[perfil];
  const alerta = useRef<HTMLParagraphElement>(null);
  // Error al enviar: el foco va al mensaje (lectores de pantalla y teclado lo encuentran).
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);

  const entrar = (sesion: SesionActiva) => {
    // Solo rutas internas de la zona del rol (nunca una URL externa en ?volver).
    const destino = volver?.startsWith(`/${zonaDeRol(sesion.rol)}`) ? volver : inicioDeRol(sesion.rol);
    router.replace(destino);
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const esRut = pareceRut(usuario);
    if (esRut && !rutValido(usuario)) {
      setError('El RUT no es válido. Revisa el dígito verificador.');
      return;
    }
    setEnviando(true);
    try {
      const r = desafio
        ? await verificarTotp(desafio.desafio, codigo.trim())
        : await iniciarSesion({ ...(esRut ? { rut: usuario.trim() } : { email: usuario.trim() }), password });
      if ('accessToken' in r) entrar(r);
      else {
        setDesafio(r);
        // Primer ingreso con TOTP obligatorio: secreto para agregarlo a la app.
        if (r.enrolamiento) setSecreto((await datos(api.POST('/api/auth/totp/enrolamiento', { body: { desafio: r.desafio } }))).secreto);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(
          desafio
            ? 'El código no es válido o ya venció. Escribe el que muestra ahora tu app.'
            : 'Los datos no coinciden con una cuenta con acceso. Revisa tu correo o RUT y la contraseña.',
        );
      } else setError(err instanceof ApiError ? err.message : 'No pudimos conectar con el centro. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Fondo perfil={perfil} />
      <div className="w-full max-w-[452px] rounded-lg border border-white/75 bg-[rgba(255,252,246,0.66)] px-[clamp(24px,3vw,34px)] py-[clamp(26px,3vw,34px)] shadow-lg backdrop-blur-[22px]">
        {!desafio && (
          <div role="group" aria-label="Tipo de cuenta" className="mb-6 flex rounded-full border border-white/70 bg-white/50 p-1">
            {(['paciente', 'equipo'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={perfil === p}
                onClick={() => setPerfil(p)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-full px-3.5 py-[11px] text-[13.5px] font-extrabold transition-colors duration-200 ${
                  perfil === p ? (p === 'paciente' ? 'bg-accent-2-700 text-neutral-100' : 'bg-accent-700 text-neutral-100') : 'text-text'
                }`}
              >
                <Icon name={p === 'paciente' ? 'person' : 'badge'} />
                {p === 'paciente' ? 'Soy paciente' : 'Soy del equipo'}
              </button>
            ))}
          </div>
        )}

        <Eyebrow tone={perfil === 'paciente' ? 'patient' : 'team'}>{desafio ? 'Verificación en dos pasos' : t.eyebrow}</Eyebrow>
        <h1 className="m-0 mb-2.5 text-[clamp(27px,3vw,33px)] leading-[1.05] font-black tracking-[-0.03em]">{desafio ? 'Ingresa tu código.' : t.titulo}</h1>
        <p className="m-0 mb-6 text-[14.5px] leading-relaxed text-neutral-700">
          {desafio
            ? desafio.enrolamiento
              ? 'Tu cuenta requiere verificación en dos pasos. Agrega esta clave en tu app de autenticación y escribe el código de 6 dígitos que muestra.'
              : 'Abre tu app de autenticación y escribe el código de 6 dígitos.'
            : t.bajada}
        </p>

        {porInactividad && !desafio && (
          <p
            role="status"
            className="m-0 mb-5 flex gap-2.5 rounded-lg border border-accent-500 bg-accent-200 px-4 py-3 text-[13.5px] font-bold text-accent-900"
          >
            <Icon name="timer" size={19} />
            Cerramos tu sesión porque estuvo 30 minutos sin actividad. Vuelve a ingresar para seguir donde estabas.
          </p>
        )}

        {secreto && (
          <p className="m-0 mb-5 rounded-lg border border-divider bg-bg px-4 py-3 font-mono text-sm font-bold tracking-wider break-all select-all">{secreto}</p>
        )}

        <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
          {desafio ? (
            <Field label="Código de verificación">
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  autoFocus
                />
              )}
            </Field>
          ) : (
            <>
              <Field label={t.usuario}>
                {(p) => (
                  <Input {...p} type="text" autoComplete="username" placeholder={t.ejemplo} value={usuario} onChange={(e) => setUsuario(e.target.value)} />
                )}
              </Field>
              <Field label="Contraseña">
                {(p) => (
                  <span className="relative block">
                    <Input
                      {...p}
                      type={verPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-14"
                    />
                    <button
                      type="button"
                      onClick={() => setVerPassword((v) => !v)}
                      aria-label={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                      className="absolute top-1/2 right-[9px] grid -translate-y-1/2 place-items-center rounded-full p-2 text-neutral-700 hover:bg-accent-200 hover:text-accent-700"
                    >
                      <Icon name={verPassword ? 'visibility_off' : 'visibility'} size={20} />
                    </button>
                  </span>
                )}
              </Field>
              <p className="m-0 flex items-center gap-2 text-[12.5px] font-semibold text-neutral-700">
                <Icon name="timer" size={16} />
                Por seguridad, la sesión se cierra tras 30 minutos sin actividad.
              </p>
            </>
          )}

          {error && (
            <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" variant={perfil === 'paciente' ? 'primary' : 'team'} loading={enviando} className="mt-1 w-full">
            {desafio ? 'Verificar' : t.boton}
          </Button>
          {desafio && (
            <Button variant="ghost" onClick={() => (setDesafio(null), setCodigo(''), setSecreto(undefined))}>
              Volver
            </Button>
          )}
        </form>
      </div>
    </>
  );
}

/** Manchas difusas de fondo (paciente en accent-2, equipo en accent), como en el diseño. */
function Fondo({ perfil }: { perfil: Perfil }) {
  const [base, a, b] = perfil === 'paciente' ? ['bg-accent-2-100', 'bg-accent-2-300', 'bg-accent-2-200'] : ['bg-accent-100', 'bg-accent-300', 'bg-accent-200'];
  return (
    <div aria-hidden="true" className={`fixed inset-0 -z-10 overflow-hidden transition-colors duration-500 ${base}`}>
      <span className={`absolute top-[-14%] left-[-8%] size-[52vw] animate-[deriva_22s_ease-in-out_infinite] rounded-full opacity-85 blur-[60px] ${a}`} />
      <span
        className={`absolute right-[-6%] bottom-[-20%] size-[46vw] animate-[deriva_28s_ease-in-out_infinite_reverse] rounded-full opacity-90 blur-[70px] ${b}`}
      />
      <span className="absolute top-[32%] right-[22%] size-[26vw] animate-[deriva_34s_ease-in-out_infinite] rounded-full bg-bg opacity-75 blur-[60px]" />
    </div>
  );
}
