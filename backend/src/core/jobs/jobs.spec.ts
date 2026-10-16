/**
 * A5 (02h): cada job se dispara segun su programacion. Reloj simulado (fake
 * timers de Jest, que tambien controlan Date): se registran los @Cron reales
 * con ScheduleModule y se avanza un dia. conLock se reemplaza para contar
 * disparos sin BD.
 */
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';

import { RecordatoriosService } from '../../modulos/agenda/recordatorios.service';
import { ContextoBd } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';
import { ProveedorCalendario } from '../integraciones/calendario';
import { ProveedorCorreo } from '../notificaciones/correo';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import { JobsService } from './jobs.service';

const HORA = 3_600_000;
const INICIO = new Date('2026-10-12T00:00:00-03:00');

describe('programacion de jobs (reloj simulado)', () => {
  const disparos: { job: string; en: Date }[] = [];

  beforeAll(async () => {
    jest.useFakeTimers({ now: INICIO });
    jest.spyOn(JobsService.prototype, 'conLock').mockImplementation(async (job: string) => {
      disparos.push({ job, en: new Date() });
      return { corrio: true, total: 0 };
    });
    const modulo = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        JobsService,
        NotificacionesService,
        RecordatoriosService,
        { provide: ContextoBd, useValue: {} },
        { provide: LlaveroService, useValue: {} },
        { provide: ProveedorCorreo, useValue: {} },
        { provide: ProveedorCalendario, useValue: {} },
        // JOBS_HABILITADOS=false: sin la corrida de procesar_bajas al arrancar.
        { provide: ConfigService, useValue: { get: () => false } },
      ],
    }).compile();
    await modulo.init();
    await jest.advanceTimersByTimeAsync(24 * HORA);
    await modulo.close();
  });

  afterAll(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const de = (job: string) => disparos.filter((d) => d.job === job);

  it('cada 10 minutos: ofertas de derivacion, avisos vencidos, consentimientos por vencer, recordatorios y solicitudes de hora', () => {
    for (const job of [
      'expirar_ofertas_derivacion',
      'cerrar_avisos_vencidos',
      'avisar_consentimientos_por_vencer',
      'enviar_recordatorios',
      'limpiar_solicitudes',
    ]) {
      expect(de(job)).toHaveLength(144);
      expect(de(job).every((d) => d.en.getUTCMinutes() % 10 === 0 && d.en.getUTCSeconds() === 0)).toBe(true);
    }
  });

  it('cada hora: procesar bajas', () => {
    expect(de('procesar_bajas')).toHaveLength(24);
    expect(de('procesar_bajas').every((d) => d.en.getUTCMinutes() === 0)).toBe(true);
  });

  it('cada minuto: enviar notificaciones y reintentar correos de cuenta', () => {
    expect(de('enviar_notificaciones')).toHaveLength(24 * 60);
    expect(de('reintentar_correos_cuenta')).toHaveLength(24 * 60);
  });

  it('una vez al dia a las 03:30 de Chile: purgar mensajes internos', () => {
    const purga = de('purgar_mensajes_internos');
    expect(purga).toHaveLength(1);
    expect(purga[0].en.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour12: false })).toBe('03:30:00');
  });

  it('una vez al dia a las 03:00 de Chile: verificar canarios', () => {
    const canarios = de('verificar_canarios');
    expect(canarios).toHaveLength(1);
    expect(canarios[0].en.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour12: false })).toBe('03:00:00');
  });

  it('no hay jobs sin cubrir por este test', () => {
    expect(new Set(disparos.map((d) => d.job))).toEqual(
      new Set([
        'expirar_ofertas_derivacion',
        'cerrar_avisos_vencidos',
        'avisar_consentimientos_por_vencer',
        'enviar_recordatorios',
        'limpiar_solicitudes',
        'procesar_bajas',
        'enviar_notificaciones',
        'reintentar_correos_cuenta',
        'purgar_mensajes_internos',
        'verificar_canarios',
      ]),
    );
  });
});
