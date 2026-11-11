'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { ApiError } from '@/lib/api/errores';
import { pareceRut, rutValido } from '@/lib/formato';
import { destinoTrasIngreso, NOMBRE_ROL } from '@/lib/roles';
import { useCentroPublico, useSesion } from '@/lib/consultas';
import { cambiarRol, iniciarSesion, renovarSesion, type DesafioSegundoFactor, type Rol, type SesionActiva } from '@/lib/sesion';

import { CampoRut, rutNormalizado } from './CampoRut';
import { PasoSegundoFactor } from './PasoSegundoFactor';
import { TarjetaIngreso, type PerfilIngreso } from './TarjetaIngreso';

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

/*
 * Textos del diseño "Inicio de sesión · Moderno". Ajustes por reglas de negocio:
 * - paciente: "Mensajes con tu profesional" -> "Escríbele a tu profesional"
 *   (el paciente escribe por formulario; el profesional responde por canal externo).
 * - el codigo por correo es obligatorio para el equipo y opcional para pacientes.
 * - cada punto aparece solo si su modulo esta activo (null = siempre).
 */
const TEXTOS = {
  paciente: {
    eyebrow: 'Acceso de pacientes',
    titulo: 'Hola de nuevo.',
    bajada: 'Entra para ver tus horas agendadas, escribirle a tu profesional y revisar tus datos.',
    tarjeta: 'Entra a tu cuenta',
    ejemplo: 'tu@correo.cl o 12.345.678-9',
    boton: 'Entrar a mi cuenta',
    codigo: 'Si activaste la verificación en dos pasos, te pediremos un código por correo.',
    puntos: [
      { texto: 'Tus horas y pagos en un solo lugar', modulo: 'AGENDA' },
      { texto: 'Escríbele a tu profesional desde tu cuenta', modulo: null },
      { texto: 'Documentos que te emita el centro', modulo: null },
    ],
  },
  equipo: {
    eyebrow: 'Acceso del equipo',
    titulo: 'Bienvenido de vuelta.',
    bajada: 'Ingresa con tu cuenta del centro para ver tu agenda, tus fichas y los módulos activos.',
    tarjeta: 'Entra al panel',
    ejemplo: 'nombre@centro.cl o 12.345.678-9',
    boton: 'Entrar al panel',
    codigo: 'Te pediremos un código por correo.',
    puntos: [
      { texto: 'Agenda y boxes del día', modulo: 'AGENDA' },
      { texto: 'Fichas visibles solo para su equipo tratante', modulo: 'FICHAS' },
      { texto: 'Verificación en dos pasos por correo', modulo: null },
    ],
  },
} as const;

/**
 * Login (diseño "Inicio de sesión · Moderno": presentacion del perfil a la
 * izquierda y tarjeta translucida a la derecha): correo o RUT y contraseña; si la cuenta
 * tiene TOTP, segundo paso con el codigo. El perfil solo cambia textos: el
 * rol lo decide la API. Desde aca: recuperar contraseña, enlace de acceso por
 * correo (pacientes) e invitacion (se activa con el enlace del correo).
 */
export function FormularioIngreso() {
  const router = useRouter();
  const parametros = useSearchParams();
  const porInactividad = parametros.get('motivo') === 'inactividad';
  const porOtroIngreso = parametros.get('motivo') === 'otro-ingreso';
  const porClaveCambiada = parametros.get('motivo') === 'clave-cambiada';
  const [perfil, setPerfil] = useState<PerfilIngreso>(parametros.get('perfil') === 'equipo' ? 'equipo' : 'paciente');
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [desafio, setDesafio] = useState<DesafioSegundoFactor | null>(null);
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);
  const t = TEXTOS[perfil];
  const modulos = useCentroPublico().data?.modulos;
  const alerta = useRef<HTMLParagraphElement>(null);
  // Error al enviar: el foco va al mensaje (lectores de pantalla y teclado lo encuentran).
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);

  // Punto 19 (2026-11-11): con mas de un rol, entre el ingreso y el panel se elige con cual entrar.
  const [eligiendo, setEligiendo] = useState<SesionActiva | null>(null);
  const entrar = (s: SesionActiva) => (s.roles.length > 1 ? setEligiendo(s) : router.replace(destinoTrasIngreso(s.rol)));
  // 03b-4.1: con una sesion viva (cookie de refresh) no se pide entrar de nuevo.
  const sesion = useSesion();
  useEffect(() => {
    if (sesion.tipo === 'desconocida') void renovarSesion();
    else if (sesion.tipo === 'activa' && !desafio && !eligiendo && !enviando) router.replace(destinoTrasIngreso(sesion.sesion.rol));
  }, [sesion, desafio, eligiendo, enviando, router]);

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

  if (eligiendo) {
    return (
      <TarjetaIngreso perfil="equipo">
        <ElegirRol sesion={eligiendo} onElegido={(rol) => router.replace(destinoTrasIngreso(rol))} />
      </TarjetaIngreso>
    );
  }

  if (desafio) {
    return (
      <TarjetaIngreso perfil={perfil}>
        <PasoSegundoFactor desafio={desafio} onEntrar={entrar} onVolver={() => setDesafio(null)} />
      </TarjetaIngreso>
    );
  }

  const color = perfil === 'paciente' ? 'text-accent-2-700' : 'text-accent-700';
  const punto = perfil === 'paciente' ? 'bg-accent-2-700' : 'bg-accent-700';
  return (
    <div className="flex w-full max-w-[1040px] flex-wrap items-center justify-center gap-x-12 gap-y-8">
      {/* Presentacion del perfil (columna izquierda del diseño). */}
      <div className="entrada flex max-w-[440px] flex-[1_1_360px] flex-col gap-3.5">
        <span className={`text-xs font-bold tracking-[0.14em] uppercase ${color}`}>{t.eyebrow}</span>
        <h1 className="m-0 text-[clamp(40px,5.4vw,64px)] leading-[0.98] font-black tracking-[-0.01em]">{t.titulo}</h1>
        <p className="m-0 text-[17px] text-pretty text-neutral-800">{t.bajada}</p>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 pt-1.5">
          {t.puntos
            .filter((p) => !p.modulo || !modulos || modulos.includes(p.modulo))
            .map((p) => (
              <li key={p.texto} className="flex items-center gap-2.5 text-sm text-neutral-800">
                <span aria-hidden="true" className={`size-2 flex-none rounded-full ${punto}`} />
                {p.texto}
              </li>
            ))}
        </ul>
      </div>

      <TarjetaIngreso perfil={perfil}>
        <div role="group" aria-label="Tipo de cuenta" className="mb-[18px] grid grid-cols-2 gap-1 rounded-full bg-neutral-200 p-1">
          {(['paciente', 'equipo'] as const).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={perfil === p}
              onClick={() => setPerfil(p)}
              className={`min-h-[46px] cursor-pointer rounded-full px-3 text-sm font-bold transition-colors duration-200 ${
                perfil === p ? (p === 'paciente' ? 'bg-accent-2-700 text-neutral-100' : 'bg-accent-700 text-neutral-100') : 'text-text hover:bg-neutral-300'
              }`}
            >
              {p === 'paciente' ? 'Soy paciente' : 'Soy del equipo'}
            </button>
          ))}
        </div>

        <h2 className="m-0 mb-[18px] text-[26px] leading-[1.1] font-black tracking-[-0.02em]">{t.tarjeta}</h2>

        {porInactividad && (
          <p
            role="status"
            className="m-0 mb-5 flex gap-2.5 rounded-lg border border-accent-500 bg-accent-200 px-4 py-3 text-[13.5px] font-bold text-accent-900"
          >
            <Icon name="timer" size={19} />
            Cerramos tu sesión porque estuvo 30 minutos sin actividad. Vuelve a ingresar: entrarás al inicio.
          </p>
        )}
        {porOtroIngreso && (
          <p
            role="status"
            className="m-0 mb-5 flex gap-2.5 rounded-lg border border-accent-500 bg-accent-200 px-4 py-3 text-[13.5px] font-bold text-accent-900"
          >
            <Icon name="lock" size={19} />
            Tu sesión se cerró porque se ingresó con tu cuenta en otro navegador o dispositivo. Si no fuiste tú, cambia tu contraseña al entrar.
          </p>
        )}
        {porClaveCambiada && (
          <p
            role="status"
            className="m-0 mb-5 flex gap-2.5 rounded-lg border border-accent-2-500 bg-accent-2-200 px-4 py-3 text-[13.5px] font-bold text-accent-2-900"
          >
            <Icon name="check" size={19} />
            Tu contraseña cambió y cerramos tus sesiones. Ingresa con la contraseña nueva.
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
          <p className="m-0 text-xs font-semibold text-neutral-700">Por seguridad, la sesión se cierra tras 30 minutos sin actividad. {t.codigo}</p>

          {error && (
            <p ref={alerta} tabIndex={-1} role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" variant={perfil === 'paciente' ? 'primary' : 'team'} loading={enviando} className="mt-1 w-full">
            {t.boton}
          </Button>
        </form>

        <div className="mt-5 flex flex-col gap-2 border-t border-borde pt-3.5 text-[13px] font-bold">
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
    </div>
  );
}

/**
 * Punto 19: la cuenta con varios roles (por ejemplo cuenta madre y profesional) elige con cual entrar. Cada rol
 * es una sesion distinta (token nuevo); despues se cambia desde el menu. El boton queda bloqueado mientras responde la API.
 */
function ElegirRol({ sesion, onElegido }: { sesion: SesionActiva; onElegido: (rol: Rol) => void }) {
  const [cambiando, setCambiando] = useState<Rol | null>(null);
  const [error, setError] = useState<string>();
  const elegir = async (rol: Rol) => {
    setCambiando(rol);
    setError(undefined);
    try {
      if (rol !== sesion.rol) await cambiarRol(rol);
      onElegido(rol);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos entrar con ese rol. Intenta de nuevo.');
      setCambiando(null);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-[26px] leading-[1.1] font-black tracking-[-0.02em]">¿Con qué rol entras?</h2>
      <p className="m-0 text-[14px] font-semibold text-neutral-800">Tu cuenta tiene más de un rol. Puedes cambiarlo después desde el menú.</p>
      <div role="group" aria-label="Roles de tu cuenta" className="flex flex-col gap-2.5">
        {sesion.roles.map((r) => (
          <Button
            key={r}
            type="button"
            size="lg"
            variant={r === sesion.rol ? 'team' : 'secondary'}
            loading={cambiando === r}
            disabled={cambiando !== null}
            onClick={() => void elegir(r)}
            className="w-full"
          >
            {NOMBRE_ROL[r]}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="m-0 text-[13.5px] font-bold text-accent-700">
          {error}
        </p>
      )}
    </div>
  );
}
