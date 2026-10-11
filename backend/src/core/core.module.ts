import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';

import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtGuard, RolesGuard } from './auth/guards';
import { BdModule } from './bd/bd.module';
import { validarEntorno } from './config/entorno';
import { CryptoModule } from './crypto/crypto.module';
import { FiltroErrores } from './errores/filtro-errores';
import { JobsService } from './jobs/jobs.service';
import { CalendarioIcs, ProveedorCalendario } from './integraciones/calendario';
import { ProveedorVideollamada, ProveedorVideollamadaPorProfesional, ProveedorVideollamadaSimulado } from './integraciones/videollamada';
import { ProveedorCorreo, ProveedorCorreoSimulado, ProveedorCorreoSmtp } from './notificaciones/correo';
import { NotificacionesController } from './notificaciones/notificaciones.controller';
import { NotificacionesService } from './notificaciones/notificaciones.service';
import { idSolicitud, opcionesLogger } from './logs/logs';
import { PrismaModule } from './prisma/prisma.module';
import { RlsInterceptor } from './rls/rls.interceptor';
import { SaludController } from './salud/salud.controller';

export interface OpcionesCore {
  /** Destino de los logs (tests: un stream en memoria). Por defecto stdout. */
  destinoLogs?: DestinationStream;
}

/**
 * Nucleo transversal (02a): configuracion validada, logs, CLS, BD con
 * contexto RLS y cifrado, auth, errores, jobs y salud. Lo usan todos los
 * modulos; ningun modulo de negocio vive aqui.
 *
 * Orden por request: JwtGuard -> RolesGuard -> RlsInterceptor (transaccion +
 * set_config + acceso_vigente) -> handler -> COMMIT -> respuesta. El
 * FiltroErrores traduce cualquier error de ese recorrido.
 */
@Module({})
export class CoreModule {
  static forRoot(opciones: OpcionesCore = {}): DynamicModule {
    const jobsHabilitados = process.env.JOBS_HABILITADOS !== 'false';
    return {
      module: CoreModule,
      global: true,
      imports: [
        ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validarEntorno }),
        LoggerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => opcionesLogger(config.get<string>('LOG_LEVEL', 'info'), opciones.destinoLogs),
        }),
        ClsModule.forRoot({ global: true, middleware: { mount: true, generateId: true, idGenerator: idSolicitud } }),
        EventEmitterModule.forRoot({ global: true, wildcard: false }),
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            throttlers: [
              { name: 'login', ttl: 60_000, limit: config.getOrThrow<number>('LOGIN_LIMITE_POR_MINUTO') },
              { name: 'publico', ttl: 60_000, limit: config.getOrThrow<number>('PUBLICO_LIMITE_POR_MINUTO') },
            ],
          }),
        }),
        JwtModule.registerAsync({
          global: true,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            secret: config.getOrThrow<string>('JWT_SECRET'),
            signOptions: { algorithm: 'HS256' },
            verifyOptions: { algorithms: ['HS256'] },
          }),
        }),
        ...(jobsHabilitados ? [ScheduleModule.forRoot()] : []),
        PrismaModule,
        CryptoModule,
        BdModule,
      ],
      controllers: [AuthController, SaludController, NotificacionesController],
      providers: [
        AuthService,
        JobsService,
        NotificacionesService,
        // Integraciones: los modulos dependen solo de las interfaces; la
        // implementacion se elige aqui por configuracion (integraciones.md).
        {
          provide: ProveedorCorreo,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const url = config.get<string>('SMTP_URL');
            return url ? new ProveedorCorreoSmtp(url, config.getOrThrow<string>('CORREO_REMITENTE')) : new ProveedorCorreoSimulado();
          },
        },
        {
          provide: ProveedorVideollamada,
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            config.get<boolean>('VIDEOLLAMADA_SIMULADA')
              ? new ProveedorVideollamadaSimulado()
              : new ProveedorVideollamadaPorProfesional(config.get<boolean>('JITSI_HABILITADO') ?? false, config.getOrThrow<string>('JITSI_URL_BASE')),
        },
        { provide: ProveedorCalendario, useClass: CalendarioIcs },
        { provide: APP_GUARD, useClass: JwtGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_INTERCEPTOR, useClass: RlsInterceptor },
        { provide: APP_FILTER, useClass: FiltroErrores },
      ],
      exports: [JobsService, NotificacionesService, ProveedorCorreo, ProveedorVideollamada, ProveedorCalendario],
    };
  }
}
