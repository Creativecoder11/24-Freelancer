import { Injectable, Logger } from '@nestjs/common';
import type { OtpChannel, OtpPurpose } from '@24f/shared';
import { getEnv } from '../../config/env';
import { RedisService } from '../../common/redis.service';

export interface OtpMessage {
  channel: OtpChannel;
  destination: string;
  purpose: OtpPurpose;
  code: string;
  expiresMinutes: number;
}

/** Adapter for OTP delivery (Doc 04 §2.8). Providers implement `send`. */
export abstract class OtpDeliveryAdapter {
  abstract send(msg: OtpMessage): Promise<void>;
}

const PURPOSE_TEXT: Record<string, string> = {
  signup: 'to verify your account',
  login: 'to sign in',
  password_reset: 'to reset your password',
  new_device: 'to sign in on a new device',
  first_withdrawal: 'to confirm your withdrawal',
  contact_change: 'to confirm your new contact',
};

export function otpText(m: OtpMessage) {
  return `${m.code} is your 24 Freelancing code ${PURPOSE_TEXT[m.purpose] ?? ''}. It expires in ${m.expiresMinutes} minutes. Never share it.`;
}

/**
 * Local/test driver: logs the code and keeps the last code per destination in Redis
 * (`otp:last:<destination>`, 10 min) so scripts and browser tests can read it.
 * Refused outside local/test by the env schema.
 */
@Injectable()
export class LogOtpDelivery extends OtpDeliveryAdapter {
  private readonly log = new Logger('OtpDelivery');
  constructor(private readonly redis: RedisService) {
    super();
  }

  async send(m: OtpMessage) {
    this.log.log(`[${m.channel}] → ${m.destination} (${m.purpose}): ${otpText(m)}`);
    await this.redis.client.set(`otp:last:${m.destination}`, m.code, 'EX', m.expiresMinutes * 60);
  }
}

export const otpDeliveryProvider = {
  provide: OtpDeliveryAdapter,
  inject: [RedisService],
  useFactory: (redis: RedisService) => {
    const driver = getEnv().OTP_DELIVERY_DRIVER;
    // Only the log driver exists so far; 'email' (and SMS gateways) plug in here.
    if (driver !== 'log') new Logger('OtpDelivery').warn(`OTP_DELIVERY_DRIVER=${driver} has no adapter yet; using the log driver`);
    return new LogOtpDelivery(redis);
  },
};
