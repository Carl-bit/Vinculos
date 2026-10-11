/** A6 (02h): integraciones sin configuracion de terceros. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { UnprocessableEntityException } from '@nestjs/common';

import { CalendarioIcs, eventoDeCita } from './calendario';
import { ProveedorVideollamadaPorProfesional, ProveedorVideollamadaSimulado, type SolicitudSala } from './videollamada';

const sala = (s: Partial<SolicitudSala>): SolicitudSala => ({
  citaId: 'c1',
  inicio: new Date('2026-11-02T13:00:00Z'),
  fin: new Date('2026-11-02T14:00:00Z'),
  expiraEn: new Date('2026-11-02T16:00:00Z'),
  modo: 'ENLACE_PROPIO',
  enlacePropio: null,
  ...s,
});

describe('videollamada: cada modo genera el enlace esperado', () => {
  it('ENLACE_PROPIO (default): la sala fija del profesional; sin enlace configurado -> 422', async () => {
    const p = new ProveedorVideollamadaPorProfesional(false, 'https://meet.jit.si');
    await expect(p.crearSala(sala({ enlacePropio: 'https://zoom.us/j/123' }))).resolves.toEqual({
      url: 'https://zoom.us/j/123',
      expiraEn: new Date('2026-11-02T16:00:00Z'),
    });
    await expect(p.crearSala(sala({}))).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('JITSI: desactivado por defecto (422); habilitado, sala unica y no adivinable bajo la URL base', async () => {
    await expect(new ProveedorVideollamadaPorProfesional(false, 'https://meet.jit.si').crearSala(sala({ modo: 'JITSI' }))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    const p = new ProveedorVideollamadaPorProfesional(true, 'https://jitsi.centro.cl/');
    const a = await p.crearSala(sala({ modo: 'JITSI' }));
    const b = await p.crearSala(sala({ modo: 'JITSI' }));
    expect(a.url).toMatch(/^https:\/\/jitsi\.centro\.cl\/vinculos-[0-9a-f]{32}$/);
    expect(a.url).not.toBe(b.url);
  });

  it('simulado (tests): URL aleatoria local', async () => {
    const r = await new ProveedorVideollamadaSimulado().crearSala(sala({}));
    expect(r.url).toMatch(/^https:\/\/videollamada\.simulada\.local\/sala\//);
  });
});

describe('calendario .ics: solo "Sesion", modalidad, horario y enlace o box', () => {
  const ics = new CalendarioIcs();

  it('presencial con box; online con enlace; POR_REPROGRAMAR marcada como tentativa', () => {
    const texto = ics.calendario('Centro Prueba', [
      eventoDeCita({ id: 'a', inicio: new Date('2026-11-02T13:00:00Z'), fin: new Date('2026-11-02T14:00:00Z'), modalidad: 'PRESENCIAL', estado: 'CONFIRMADA', espacio: 'Box 1', enlace: null }),
      eventoDeCita({ id: 'b', inicio: new Date('2026-11-03T13:00:00Z'), fin: new Date('2026-11-03T14:00:00Z'), modalidad: 'ONLINE', estado: 'POR_REPROGRAMAR', espacio: null, enlace: 'https://sala/x' }),
    ]);
    expect(texto.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(texto).toContain('DTSTART:20261102T130000Z');
    expect(texto).toContain('SUMMARY:Sesión\r\n');
    expect(texto).toContain('LOCATION:Box 1');
    expect(texto).toContain('SUMMARY:Sesión (por reprogramar)');
    expect(texto).toContain('STATUS:TENTATIVE');
    expect(texto).toContain('LOCATION:https://sala/x');
    // Solo estas propiedades por evento: nada de paciente, motivo ni notas.
    const propiedades = new Set(
      texto
        .split('\r\n')
        .filter((l) => l && !l.startsWith(' '))
        .map((l) => l.split(/[:;]/)[0]),
    );
    expect([...propiedades].sort()).toEqual(
      ['BEGIN', 'CALSCALE', 'DESCRIPTION', 'DTEND', 'DTSTAMP', 'DTSTART', 'END', 'LOCATION', 'METHOD', 'PRODID', 'STATUS', 'SUMMARY', 'UID', 'VERSION', 'X-WR-CALNAME'].sort(),
    );
  });

  it('pliega lineas largas a 75 octetos', () => {
    const texto = ics.calendario('x'.repeat(200), []);
    expect(texto.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});

describe('arquitectura: ningun modulo importa una implementacion concreta', () => {
  const CONCRETAS = /ProveedorCorreoSmtp|ProveedorCorreoSimulado|ProveedorVideollamadaSimulado|ProveedorVideollamadaPorProfesional|CalendarioIcs|nodemailer/;

  const archivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const ruta = join(dir, f);
      return statSync(ruta).isDirectory() ? archivos(ruta) : ruta.endsWith('.ts') ? [ruta] : [];
    });

  it('src/modulos solo usa las interfaces de core', () => {
    const infractores = archivos(join(__dirname, '..', '..', 'modulos')).filter((f) => CONCRETAS.test(readFileSync(f, 'utf8')));
    expect(infractores).toEqual([]);
  });

  it('en core, solo CoreModule elige la implementacion', () => {
    const usos = archivos(join(__dirname, '..'))
      .filter((f) => !f.endsWith('.spec.ts') && !/[\\/](integraciones|notificaciones)[\\/](calendario|videollamada|correo)\.ts$/.test(f))
      .filter((f) => CONCRETAS.test(readFileSync(f, 'utf8')))
      .map((f) => f.split(/[\\/]/).pop());
    expect(usos).toEqual(['core.module.ts']);
  });
});
