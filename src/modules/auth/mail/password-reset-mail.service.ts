import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../../mail/mail.service';
import { passwordResetMail } from '../../mail/templates';

@Injectable()
export class PasswordResetMailService {
  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  send(email: string, token: string): Promise<void> {
    const baseUrl = this.config.get<string>(
      'APP_BASE_URL',
      'http://localhost:4200',
    );
    const url = `${baseUrl}/reset-password?token=${token}`;
    return this.mail.send(passwordResetMail(email, url));
  }
}
