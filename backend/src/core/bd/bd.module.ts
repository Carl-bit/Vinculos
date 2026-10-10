import { Global, Module } from '@nestjs/common';

import { ContextoBd } from './contexto-bd.service';

@Global()
@Module({
  providers: [ContextoBd],
  exports: [ContextoBd],
})
export class BdModule {}
