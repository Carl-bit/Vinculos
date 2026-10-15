import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { TAGS } from '../docs/openapi';
import { Publico } from '../auth/decoradores';
import { ContextoBd } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';

/**
 * GET /salud: BD alcanzable y canarios OK (verificacion en vivo con la KEK
 * montada, sin registrar evento). Sin datos sensibles: solo booleanos.
 */
@ApiTags(TAGS.salud)
@Controller('salud')
@Publico()
@SkipThrottle()
export class SaludController {
  constructor(
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  @Get()
  async salud(@Res({ passthrough: true }) res: Response): Promise<{ estado: 'ok' | 'error'; bd: boolean; canarios: boolean }> {
    const bd = await this.bd.sinContexto('salud').$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    const canarios =
      bd &&
      (await this.llavero
        .verificar()
        .then(() => true)
        .catch(() => false));
    const ok = bd && canarios;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { estado: ok ? 'ok' : 'error', bd, canarios };
  }
}
