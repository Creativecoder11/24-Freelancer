import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PAYOUT_METHOD_TYPE, type PayoutMethodType } from '@24f/shared';
import { ZodPipe } from '../../common/zod.pipe';
import { Paged } from '../../common/envelope.interceptor';
import { ApiError } from '../../common/api-error';
import { AuthModule } from '../auth/auth.module';
import { AllowStatus, CurrentUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PayoutMethodsService } from './payout-methods.service';

const pw = z.string({ required_error: "That password isn't right." }).min(1, "That password isn't right.");
const addSchema = z.object({
  method_type: z.enum(PAYOUT_METHOD_TYPE.values as unknown as [string, ...string[]], { errorMap: () => ({ message: 'Choose where to send your money.' }) }),
  account: z.string({ required_error: 'Enter the account number.' }).trim().min(1, 'Enter the account number.').max(64),
  is_default: z.boolean().optional(),
  password: pw,
});
const defaultSchema = z.object({ is_default: z.literal(true, { errorMap: () => ({ message: 'Only “Make default” is supported.' }) }), password: pw });
const deleteSchema = z.object({ password: pw });
const idPipe = new ParseUUIDPipe({ exceptionFactory: () => new ApiError('PAYOUT_METHOD_INVALID') });

/** Doc 06 §5.11 payout methods. */
@Controller('payout-methods')
@UseGuards(JwtAuthGuard)
@AllowStatus('active', 'restricted')
export class PayoutMethodsController {
  constructor(private readonly svc: PayoutMethodsService) {}

  @Get()
  async list(@CurrentUser('id') uid: string) {
    const r = await this.svc.list(uid);
    return new Paged(r.data, r.meta);
  }

  @Post()
  add(@CurrentUser('id') uid: string, @Body(new ZodPipe(addSchema)) body: z.infer<typeof addSchema>) {
    return this.svc.add(uid, { ...body, method_type: body.method_type as PayoutMethodType });
  }

  @Patch(':id')
  makeDefault(@CurrentUser('id') uid: string, @Param('id', idPipe) id: string, @Body(new ZodPipe(defaultSchema)) body: { is_default: true; password: string }) {
    return this.svc.makeDefault(uid, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser('id') uid: string, @Param('id', idPipe) id: string, @Body(new ZodPipe(deleteSchema)) body: { password: string }) {
    return this.svc.remove(uid, id, body);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [PayoutMethodsController],
  providers: [PayoutMethodsService],
  exports: [PayoutMethodsService],
})
export class PayoutMethodsModule {}
