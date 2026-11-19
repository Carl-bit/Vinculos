'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button, clasesBoton } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { api, datos } from '@/lib/api/cliente';
import { ApiError } from '@/lib/api/errores';

const HTTPS = /^https:\/\/\S+$/;

/**
 * 2026-11-18: enlace de la sala de una sesion online (inicio y detalle de la cita). Si ya hay sala, se entra con
 * un clic; el profesional de la cita (o ADMIN/GESTION, la API valida) la agrega o la cambia y el paciente recibe
 * el aviso por correo (ENLACE_ONLINE). Sin sala configurada la cita se agenda igual: este es el paso despues.
 */
export function EnlaceSesion({ citaId, puedeEditar }: { citaId: string; puedeEditar: boolean }) {
  const cliente = useQueryClient();
  const enlace = useQuery({
    queryKey: ['panel', 'enlace', citaId],
    queryFn: async () => {
      try {
        return await datos(api.GET('/api/citas/{id}/enlace', { params: { path: { id: citaId } } }));
      } catch (e) {
        // Sin enlace (404) o vencido (410): todavia no hay sala para entrar.
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) return null;
        throw e;
      }
    },
    retry: false,
  });
  const [abierto, setAbierto] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const guardar = useMutation({
    mutationFn: () => datos(api.PUT('/api/citas/{id}/enlace', { params: { path: { id: citaId } }, body: { url: url.trim() } })),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['panel', 'enlace', citaId] });
      setAbierto(false);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No pudimos guardar el enlace.'),
  });
  const abrir = () => {
    setUrl(enlace.data?.url ?? '');
    setError(undefined);
    setAbierto(true);
  };
  const hay = !!enlace.data;

  return (
    <>
      {hay && (
        <a href={enlace.data!.url} target="_blank" rel="noopener noreferrer" className={clasesBoton('secondary')}>
          <Icon name="videocam" size={18} />
          Entrar a la sala
          <span className="sr-only"> (se abre en otra pestaña)</span>
        </a>
      )}
      {puedeEditar && (
        <Button variant={hay ? 'ghost' : 'secondary'} icon="link" onClick={abrir} disabled={enlace.isPending}>
          {hay ? 'Cambiar enlace' : 'Agregar enlace de la sala'}
        </Button>
      )}
      <Modal
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        titulo={hay ? 'Cambiar el enlace de la sala' : 'Agregar el enlace de la sala'}
        descripcion="Pega el enlace de Meet, Zoom u otra sala (https). Al guardarlo, el paciente recibe un correo con el enlace para entrar."
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!HTTPS.test(url.trim())) return setError('Escribe un enlace que empiece con https://');
            guardar.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Enlace de la sala" required error={error}>
            {(p) => <Input {...p} type="url" inputMode="url" autoComplete="off" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2.5">
            <Button variant="ghost" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="team" icon="send" loading={guardar.isPending}>
              Guardar y avisar al paciente
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
