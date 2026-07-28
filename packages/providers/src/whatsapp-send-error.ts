import { AppError } from '@shopee-auto-affiliate-ai/shared';

export class WhatsAppSendError extends AppError {
  readonly deliveryMayHaveStarted: boolean;

  constructor(
    message: string,
    code: string,
    options: { deliveryMayHaveStarted: boolean },
  ) {
    super(message, code);
    this.deliveryMayHaveStarted = options.deliveryMayHaveStarted;
  }
}
