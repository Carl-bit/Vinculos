'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { Encabezado } from '@/components/shared/Encabezado';
import { Icon } from '@/components/ui/Icon';
import { Pestanas } from '@/components/ui/Pestanas';

import { DatosCentro } from './DatosCentro';
import { HorarioCentroEditor, PoliticasCentro } from './HorarioPoliticasCentro';
import { PlantillasMensaje } from './PlantillasMensaje';
import { ReglasCentro } from './ReglasCentro';

type Vista = 'datos' | 'modulos' | 'horario' | 'politicas' | 'notificaciones' | 'reglas' | 'roles';
const VISTAS: { valor: Vista; etiqueta: string }[] = [
  { valor: 'datos', etiqueta: 'Datos del centro' },
  { valor: 'modulos', etiqueta: 'Módulos contratados' },
  { valor: 'horario', etiqueta: 'Horario de atención' },
  { valor: 'politicas', etiqueta: 'Consentimiento y políticas' },
  { valor: 'notificaciones', etiqueta: 'Notificaciones' },
  { valor: 'reglas', etiqueta: 'Reglas y plazos' },
  { valor: 'roles', etiqueta: 'Roles y accesos' },
];

/**
 * Configuracion del centro (diseño "Admin - Configuracion", solo ADMIN).
 * Fuera de la API y por eso no se muestran: dominio propio y envio por
 * WhatsApp (ver brechas.md). `?vista=cobros` abre las reglas de cobro.
 */
export function ConfiguracionCentro() {
  const router = useRouter();
  const parametros = useSearchParams();
  const pedida = parametros.get('vista');
  const vista = pedida === 'cobros' ? 'reglas' : (VISTAS.find((v) => v.valor === pedida)?.valor ?? 'datos');
  return (
    <>
      <Encabezado
        tono="team"
        sobretitulo="Centro"
        titulo="Configuración del centro"
        bajada="Datos, horario, políticas y reglas que usan todos los módulos y la página pública."
      />
      <p className="m-0 mb-[22px] flex items-center gap-2 text-[13px] font-semibold text-neutral-800">
        <Icon name="tune" size={17} />
        Estos parámetros atraviesan todos los módulos del centro y su página pública.
      </p>
      <div className="flex flex-col gap-5">
        <Pestanas
          etiqueta="Secciones de configuración"
          tono="team"
          valor={vista}
          onChange={(v) => router.replace(v === 'datos' ? '/admin/configuracion' : `/admin/configuracion?vista=${v}`, { scroll: false })}
          pestanas={VISTAS}
          panelId="configuracion-panel"
        />
        <div id="configuracion-panel" role="tabpanel">
          {vista === 'datos' && <DatosCentro />}
          {vista === 'horario' && <HorarioCentroEditor />}
          {vista === 'politicas' && <PoliticasCentro />}
          {vista === 'notificaciones' && <PlantillasMensaje />}
          {(vista === 'reglas' || vista === 'modulos' || vista === 'roles') && <ReglasCentro seccion={vista} />}
        </div>
      </div>
    </>
  );
}
