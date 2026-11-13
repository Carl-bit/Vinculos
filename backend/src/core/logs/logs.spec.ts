import { rutaParaLog } from './logs';

describe('rutaParaLog (AUD-02, OBS-02)', () => {
  const token = 'Zx9_secreto-del-enlace-0123456789';

  it.each([
    [`/api/calendario/${token}`, '/api/calendario/:token'],
    [`/api/recordatorios/${token}`, '/api/recordatorios/:token'],
    [`/api/recordatorios/${token}/confirmacion`, '/api/recordatorios/:token/confirmacion'],
    [`/api/recordatorios/${token}/cancelacion?x=1`, '/api/recordatorios/:token/cancelacion'],
    [`/api/documentos-clinicos/descarga/${token}`, '/api/documentos-clinicos/descarga/:token'],
  ])('quita el token de %s', (url, esperada) => {
    expect(rutaParaLog(url)).toBe(esperada);
    expect(rutaParaLog(url)).not.toContain(token);
  });

  it('deja igual las demas rutas y descarta la query', () => {
    expect(rutaParaLog('/api/pacientes?nombre=12.345.678-9')).toBe('/api/pacientes');
    expect(rutaParaLog('/api/citas/5f0c2b1e-0000-4000-8000-000000000000')).toBe('/api/citas/5f0c2b1e-0000-4000-8000-000000000000');
  });
});
