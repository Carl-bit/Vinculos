'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { ApiError } from '@/lib/api/errores';
import { pareceRut, rutValido } from '@/lib/formato';
import { destinoTrasIngreso } from '@/lib/roles';
import { useSesion } from '@/lib/consultas';
import { iniciarSesion, renovarSesion, type DesafioSegundoFactor, type SesionActiva } from '@/lib/sesion';

import { CampoRut, rutNormalizado } from './CampoRut';
import { PasoSegundoFactor } from './PasoSegundoFactor';
import { TarjetaIngreso, TituloIngreso, type PerfilIngreso } from './TarjetaIngreso';

/**
 * Solo en modo demo (NEXT_PUBLIC_DEMO=true, nunca en produccion): entrar rapido
 * con cada usuario del seed demo (docs/pruebas/usuarios_demo.md). El codigo
 * del segundo paso llega igual a Mailpit.
 */
const DEMO = process.env.NEXT_PUBLIC_DEMO === 'true' && process.env.NODE_ENV !== 'production';
const PASSWORD_DEMO = 'dev-password';
const USUARIOS_DEMO: { usuario: string; etiqueta: string; perfil: PerfilIngreso }[] = [
  { usuario: 'admin', etiqueta: 'ADMIN + PROFESIONAL (admin)', perfil: 'equipo' },
  { usuario: 'directora', etiqueta: 'ADMIN + PROFESIONAL (directora)', perfil: 'equipo' },
  { usuario: 'gestion', etiqueta: 'GESTIÓN', perfil: 'equipo' },
  { usuario: 'profesional1', etiqueta: 'PROFESIONAL (Uno)', perfil: 'equipo' },
  { usuario: 'profesional2', etiqueta: 'PROFESIONAL supervisor (Dos)', perfil: 'equipo' },
  { usuario: 'practicante', etiqueta: 'PRACTICANTE', perfil: 'equipo' },
  { usuario: 'paciente', etiqueta: 'PACIENTE adulto', perfil: 'paciente' },
  { usuario: 'adolescente', etiqueta: 'PACIENTE adolescente (16)', perfil: 'paciente' },
  { usuario: 'madre.demo', etiqueta: 'Adulto responsable', perfil: 'paciente' },
];

const TEXTOS = {
  paciente: {
    eyebrow: 'Acceso de pacientes',
    titulo: 'Hola de nuevo.',
    bajada: 'Entra para ver tus horas agendadas, escribirle a tu profesional y revisar tus datos.',
    usuario: 'Correo o RUT',
    ejemplo: 'tu@correo.cl o 12.345.678-9',
    boton: 'Entrar a mi cuenta',
  },
  equipo: {
    eyebrow: 'Acceso del equipo',
    titulo: 'Bienvenido de vuelta.',
    bajada: 'Ingresa con tu cuenta del centro para ver tu agenda, tus fichas y los módulos activos.',
    usuario: 'Correo o RUT',
    ejemplo: 'nombre@centro.cl o 12.345.678-9',
    boton: 'Entrar al panel',
  },
} as const;

/**
 * Login (diseño "Inicio de Sesion"): correo o RUT y contraseña; si la cuenta
 * tiene TOTP, segundo paso con el codigo. El perfil solo cambia textos: el
 * rol lo decide la API. Desde aca: recuperar contraseña, enlace de acceso por
 * correo (pacientes) e invitacion (se activa con el enlace del correo).
 */
export function FormularioIngreso() {
  const router = useRouter();
  const parametros = useSearchParams();
  const volver = parametros.get('volver');
  const porInactividad = parametros.get('motivo') === 'inactividad';
  const [perfil, setPerfil] = useState<PerfilIngreso>(parametros.get('perfil') === 'equipo' ? 'equipo' : 'paciente');
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [desafio, setDesafio] = useState<DesafioSegundoFactor | null>(null);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const t = TEXTOS[perfil];
  const alerta = useRef<HTMLParagraphElement>(null);
  // Error al enviar: el foco va al mensaje (lectores de pantalla y teclado lo encuentran).
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);

  const entrar = (sesion: SesionActiva) => router.replace(destinoTrasIngreso(sesion.rol, volver));
  // 03b-4.1: con una sesion viva (cookie de refresh) no se pide entrar de nuevo.
  const sesion = useSesion();
  useEffect(() => {
    if (sesion.tipo === 'desconocida') void renovarSesion();
    else if (sesion.tipo === 'activa' && !desafio) router.replace(destinoTrasIngreso(sesion.sesion.rol, volver));
  }, [sesion, desafio, router, volver]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const esRut = pareceRut(usuario);
    // El campo ya muestra el error del digito verificador (03b-4.1): no se envia.
    if (esRut && !rutValido(usuario)) return;
    setEnviando(true);
    try {
      const r = await iniciarSesion({ ...(esRut ? { rut: rutNormalizado(usuario) } : { email: usuario.trim() }), password });
      if ('accessToken' in r) entrar(r);
      else setDesafio(r);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Los datos no coinciden con una cuenta con acceso. Revisa tu correo o RUT y la contraseña.');
      } else setError(err instanceof ApiError ? err.message : 'No pudimos conectar con el centro. Intenta de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (desafio) {
    return (
      <TarjetaIngreso perfil={perfil}>
        <PasoSegundoFactor desafio={desafio} onEntrar={entrar} onVolver={() => setDesafio(null)} />
      </TarjetaIngreso>
    );
  }

  return (
    <TarjetaIngreso perfil={perfil}>
      <div role="group" aria-label="Tipo de cuenta" className="mb-6 flex rounded-full border border-white/70 bg-white/50 p-1">
        {(['paciente', 'equipo'] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={perfil === p}
            onClick={() => setPerfil(p)}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full px-3.5 py-[11px] text-[13.5px] font-extrabold transition-colors duration-200 ${
              perfil === p ? (p === 'paciente' ? 'bg-accent-2-700 text-neutral-100' : 'bg-accent-700 text-neutral-100') : 'text-text'
            }`}
          >
            <Icon name={p === 'paciente' ? 'person' : 'badge'} />
            {p === 'paciente' ? 'Soy paciente' : 'Soy del equipo'}
          </button>
        ))}
      </div>

      <Eyebrow tone={perfil === 'paciente' ? 'patient' : 'team'}>{t.eyebrow}</Eyebrow>
      <TituloIngreso titulo={t.titulo} bajada={t.bajada} />

      {porInactividad && (
        <p role="status" className="m-0 mb-5 flex gap-2.5 rounded-lg border border-accent-500 bg-accent-200 px-4 py-3 text-[13.5px] font-bold text-accent-900">
          <Icon name="timer" size={19} />
          Cerramos tu sesión porque estuvo 30 minutos sin actividad. Vuelve a ingresar para seguir donde estabas.
        </p>
      )}

      {DEMO && (
        <div className="mb-5 rounded-[18px] border border-dashed border-neutral-500 px-4 py-3">
          <Field label="Modo demo: entrar como" hint="El código del segundo paso llega a Mailpit (http://localhost:8025).">
            {(p) => (
              <Select
                {...p}
                value=""
                onChange={(e) => {
                  const u = USUARIOS_DEMO.find((x) => x.usuario === e.target.value);
                  if (!u) return;
                  setPerfil(u.perfil);
                  setUsuario(`${u.usuario}@centro-prueba.cl`);
                  setPassword(PASSWORD_DEMO);
                }}
                className="!py-2.5"
              >
                <option value="">Elige un usuario demo…</option>
                {USUARIOS_DEMO.map((u) => (
                  <option key={u.usuario} value={u.usuario}>
                    {u.etiqueta}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}

      <form onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
        <CampoRut label="Correo o RUT" oCorreo autoComplete="username" placeholder={t.ejemplo} value={usuario} onChange={setUsuario} />
        <Field
          label="Contraseña"
          aside={
            <Link href={`/cuenta/recuperar${perfil === 'equipo' ? '?perfil=equipo' : ''}`} className="text-[12.5px] font-extrabold">
              ¿La olvidaste?
            </Link>
          }
        >
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
                className="absolute top-1/2 right-[9px] grid -translate-y-1/2 cursor-pointer place-items-center rounded-full p-2 text-neutral-700 hover:bg-accent-200 hover:text-accent-700"
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

        {error && (
          <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" variant={perfil === 'paciente' ? 'primary' : 'team'} loading={enviando} className="mt-1 w-full">
          {t.boton}
        </Button>
      </form>

      <div className="mt-5 flex flex-col gap-2 border-t border-white/70 pt-4 text-[13px] font-bold">
        {perfil === 'paciente' ? (
          <>
            <Link href="/cuenta/acceso" className="flex min-h-10 items-center gap-2">
              <Icon name="mail" size={17} />
              Recibir un enlace de acceso por correo
            </Link>
            <p className="m-0 text-neutral-700">
              ¿Primera vez? <Link href="/pedir-hora">Pide tu primera hora</Link>: al confirmarla te invitamos a crear tu cuenta.
            </p>
          </>
        ) : (
          <p className="m-0 flex gap-2 text-neutral-700">
            <Icon name="key" size={17} />
            ¿Tienes una invitación? Ábrela desde el enlace que te enviamos al correo para elegir tu contraseña.
          </p>
        )}
      </div>
    </TarjetaIngreso>
  );
}
