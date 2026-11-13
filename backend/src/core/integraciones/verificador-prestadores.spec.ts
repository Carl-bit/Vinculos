import { ConfigService } from '@nestjs/config';

import { JobsService } from '../jobs/jobs.service';
import {
  ErrorVerificador,
  evaluarVerificacion,
  parsearPrestador,
  rutSinDv,
  VerificadorSimulado,
  VerificadorSuperSalud,
  type ConsultaPrestador,
} from './verificador-prestadores';

const consulta: ConsultaPrestador = { registro: '123456', rut: '12345678', nombre: 'Ana Rojas', profesion: 'Psicología clínica' };

/** Respuesta del RNPI con campos que NO se deben guardar (fecha de nacimiento, sexo, nacionalidad). */
const respuesta = {
  registro: '123456',
  rut: '12.345.678-5',
  nombres: 'ANA MARÍA',
  apellidoPaterno: 'ROJAS',
  apellidoMaterno: 'PÉREZ',
  fechaNacimiento: '1990-01-01',
  sexo: 'F',
  nacionalidad: 'CHILENA',
  titulos: [{ titulo: 'PSICÓLOGO', institucion: 'UNIVERSIDAD DE CHILE', fechaObtencion: '2014-03-01' }],
};

const http = (status: number, cuerpo: unknown = {}) => {
  const llamadas: { url: string; init?: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(cuerpo), { status });
  };
  return { fn, llamadas };
};

describe('VerificadorSimulado (default sin apikey)', () => {
  const v = new VerificadorSimulado();
  it('responde coherente y verifica', async () => {
    expect(v.simulado).toBe(true);
    expect(evaluarVerificacion(await v.buscar(consulta), consulta).estado).toBe('VERIFICADO_AUTOMATICO');
  });
  it('9...: no existe; 8...: de otro RUT', async () => {
    expect(await v.buscar({ ...consulta, registro: '900' })).toBeNull();
    expect(evaluarVerificacion(await v.buscar({ ...consulta, registro: '800' }), consulta).estado).toBe('NO_COINCIDE');
  });
});

describe('VerificadorSuperSalud (HTTP simulado)', () => {
  it('exito: consulta por registro con la apikey en la cabecera y verifica', async () => {
    const h = http(200, respuesta);
    const p = await new VerificadorSuperSalud('llave', 'https://rnpi.test/', h.fn).buscar(consulta);
    expect(h.llamadas[0].url).toBe('https://rnpi.test/api/v2/prestadores/registro/123456');
    expect((h.llamadas[0].init!.headers as Record<string, string>).apikey).toBe('llave');
    const r = evaluarVerificacion(p, consulta);
    expect(r).toEqual({ estado: 'VERIFICADO_AUTOMATICO', titulo: 'PSICÓLOGO', institucion: 'UNIVERSIDAD DE CHILE', motivo: null });
  });

  it('minimizacion: solo registro, rut, nombre y titulos (sin fecha de nacimiento, sexo ni nacionalidad)', () => {
    const p = parsearPrestador(respuesta)!;
    expect(Object.keys(p).sort()).toEqual(['nombre', 'registro', 'rut', 'titulos']);
    expect(Object.keys(p.titulos[0]).sort()).toEqual(['institucion', 'titulo']);
    expect(JSON.stringify(p)).not.toMatch(/1990|CHILENA|"F"|fechaObtencion/);
  });

  it('404: no existe -> NO_COINCIDE', async () => {
    const p = await new VerificadorSuperSalud('llave', 'https://rnpi.test', http(404).fn).buscar(consulta);
    expect(p).toBeNull();
    expect(evaluarVerificacion(p, consulta).estado).toBe('NO_COINCIDE');
  });

  it('401/403: apikey; 429: limite (sin reintentos)', async () => {
    for (const [status, motivo] of [
      [401, 'APIKEY'],
      [403, 'APIKEY'],
      [429, 'LIMITE'],
    ] as const) {
      const h = http(status);
      await expect(new VerificadorSuperSalud('llave', 'https://rnpi.test', h.fn).buscar(consulta)).rejects.toMatchObject({ motivo });
      expect(h.llamadas).toHaveLength(1);
    }
  });

  it('5xx: reintentos limitados y luego NO_DISPONIBLE', async () => {
    const h = http(503);
    const e = await new VerificadorSuperSalud('llave', 'https://rnpi.test', h.fn, 2).buscar(consulta).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorVerificador);
    expect(h.llamadas).toHaveLength(3);
  });

  it('no coincide: otro RUT, otro nombre u otra profesion', () => {
    const p = parsearPrestador(respuesta)!;
    expect(evaluarVerificacion(p, { ...consulta, rut: '11111111' }).motivo).toMatch(/RUT/);
    expect(evaluarVerificacion(p, { ...consulta, nombre: 'Carla Rojas' }).motivo).toMatch(/nombre/);
    expect(evaluarVerificacion(p, { ...consulta, profesion: 'Fonoaudiología' }).motivo).toMatch(/título/);
  });

  it('rutSinDv: con guion corta el DV; sin guion ya viene sin DV', () => {
    expect(rutSinDv('12.345.678-5')).toBe('12345678');
    expect(rutSinDv('7654321-K')).toBe('7654321');
    expect(rutSinDv('7654321')).toBe('7654321');
  });
});

describe('job mensual de reverificacion', () => {
  it('sin apikey (simulado) no corre ni toma el lock', async () => {
    const jobs = new JobsService({} as never, {} as never, { get: () => false } as unknown as ConfigService, new VerificadorSimulado());
    const lock = jest.spyOn(jobs, 'conLock');
    expect(await jobs.reverificarRegistrosSis()).toEqual({ corrio: false });
    expect(lock).not.toHaveBeenCalled();
  });
});
