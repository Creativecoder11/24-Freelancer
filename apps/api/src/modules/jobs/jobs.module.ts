import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobLifecycleService } from './job-lifecycle.service';

@Module({
  imports: [AuthModule],
  controllers: [JobsController],
  providers: [JobsService, JobLifecycleService],
  exports: [JobsService],
})
export class JobsModule {}
