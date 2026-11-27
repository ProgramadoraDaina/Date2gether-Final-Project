import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

// Gmail (or any SMTP): SMTP_USER/SMTP_PASS are an account and its app password.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('SMTP_USER') && !!this.config.get<string>('SMTP_PASS');
  }

  async send(to: string, subject: string, text: string, html: string): Promise<void> {
    const user = this.config.get<string>('SMTP_USER');
    await this.getTransporter().sendMail({
      from: this.config.get<string>('MAIL_FROM') || `Date2gether <${user}>`,
      to,
      subject,
      text,
      html,
    });
    this.logger.log('Email de recuperación enviado');
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 465);
      this.transporter = createTransport({
        host: this.config.get<string>('SMTP_HOST') || 'smtp.gmail.com',
        port,
        secure: port === 465,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
    return this.transporter;
  }
}
