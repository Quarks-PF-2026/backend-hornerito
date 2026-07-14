import { Injectable, Logger } from '@nestjs/common';

// Stub: loguea el link de verificación en vez de enviar un email real.
// Reemplazar por una implementación con Nodemailer/SendGrid sin tocar AuthService.
@Injectable()
export class VerificationMailService {
  private readonly logger = new Logger(VerificationMailService.name);

  send(email: string, token: string): Promise<void> {
    this.logger.log(`Verification email for ${email}: token=${token}`);
    return Promise.resolve();
  }
}
