import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../../mail/mail.service';
import { verificationMail } from '../../mail/templates';

@Injectable()
export class VerificationMailService {
  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  send(email: string, token: string): Promise<void> {
    const baseUrl = this.config.get<string>(
      'APP_BASE_URL',
      'http://localhost:4200',
    );
    const url = `${baseUrl}/verify?token=${token}`;
    return this.mail.send(verificationMail(email, url));
  }
}
