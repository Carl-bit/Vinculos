import 'reflect-metadata';

import { validarEntorno } from './entorno';

/** AUD-02: el modo de jobs manuales (POST /api/pruebas/jobs) nunca en produccion. */
describe('validarEntorno: JOBS_MANUALES', () => {
  const base = {
    DATABASE_URL: 'postgresql://app_user:x@localhost:5432/app',
    JWT_SECRET: 'un-secreto-de-prueba-largo-de-al-menos-32-caracteres',
    KEK_PATH: '/run/secrets/kek',
    RECUPERACION_PUBLICA_PATH: '/recuperacion.pub',
    FRONTEND_URL: 'https://centro.test',
    PASARELA_PROVEEDOR: '',
  };

  it('apagado por defecto', () => {
    expect(validarEntorno({ ...base }).JOBS_MANUALES).toBe(false);
  });

  it('se puede encender fuera de produccion', () => {
    expect(validarEntorno({ ...base, NODE_ENV: 'development', JOBS_MANUALES: 'true' }).JOBS_MANUALES).toBe(true);
  });

  it('en produccion la API no arranca si esta encendido', () => {
    expect(() => validarEntorno({ ...base, NODE_ENV: 'production', JOBS_MANUALES: 'true' })).toThrow(/JOBS_MANUALES no se permite en produccion/);
  });
});
