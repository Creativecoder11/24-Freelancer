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

@Injectable()
export class EmailOtpDelivery extends OtpDeliveryAdapter {
  private readonly log = new Logger('EmailOtpDelivery');
  constructor(private readonly redis: RedisService) {
    super();
  }

  async send(m: OtpMessage) {
    const text = otpText(m);
    this.log.log(`[Email OTP] → ${m.destination} (${m.purpose}): ${m.code}`);
    await this.redis.client.set(`otp:last:${m.destination}`, m.code, 'EX', m.expiresMinutes * 60);

    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM ?? '24 Freelancing <noreply@24freelancing.com>';
    if (resendKey && m.destination.includes('@')) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [m.destination],
            subject: `Your 24 Freelancing Code: ${m.code}`,
            html: `
              <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
                <h2 style="color: #111827; margin-bottom: 16px;">24 Freelancing Verification</h2>
                <p style="color: #4b5563; font-size: 15px;">Your verification code is:</p>
                <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #1f2937; margin: 20px 0;">
                  ${m.code}
                </div>
                <p style="color: #6b7280; font-size: 13px;">This code will expire in ${m.expiresMinutes} minutes. If you did not request this, please ignore this email.</p>
              </div>
            `,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          this.log.error(`Failed to send email via Resend: ${errText}`);
        } else {
          this.log.log(`Email successfully sent to ${m.destination}`);
        }
      } catch (err) {
        this.log.error(`Email delivery error: ${String(err)}`);
      }
    }
  }
}

export const otpDeliveryProvider = {
  provide: OtpDeliveryAdapter,
  inject: [RedisService],
  useFactory: (redis: RedisService) => {
    const driver = getEnv().OTP_DELIVERY_DRIVER;
    if (process.env.RESEND_API_KEY || driver === 'email') {
      return new EmailOtpDelivery(redis);
    }
    return new LogOtpDelivery(redis);
  },
};
