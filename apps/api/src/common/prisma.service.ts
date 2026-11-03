import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { prisma } from '@24f/db';

/** The shared Prisma client from @24f/db, exposed for DI. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db = prisma;

  async onModuleDestroy() {
    await prisma.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
