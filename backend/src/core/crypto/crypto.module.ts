import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { LlaveroService } from './llavero.service';

/** Global: se inicializa antes que cualquier modulo que toque datos. */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [LlaveroService],
  exports: [LlaveroService],
})
export class CryptoModule {}
