import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Envío de correo para toda la app. Con SMTP configurado usa Nodemailer;
 * sin credenciales loguea el mensaje, así el entorno de desarrollo funciona
 * sin infraestructura de correo.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  private readonly transporter: Transporter | null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    this.from =
      this.config.get<string>('MAIL_FROM') ?? user ?? 'no-reply@hornerito.app';

    if (!host || !user || !pass) {
      this.logger.warn(
        'SMTP sin configurar: los correos se loguean en vez de enviarse.',
      );
      this.transporter = null;
      return;
    }

    const port = Number(this.config.get('SMTP_PORT', '587'));
    this.transporter = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `[mail-stub] to=${message.to} subject="${message.subject}"\n${
          message.text ?? message.html
        }`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }

  onModuleDestroy(): void {
    this.transporter?.close();
  }
}
