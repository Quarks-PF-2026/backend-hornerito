/**
 * QK-17 · Recuperar Contraseña — CP-17-01 a CP-17-05
 * Casos tal como figuran en "Documentación del sprint 2 - Equipo 14.pdf".
 *
 * El flujo ya está implementado: `POST /auth/forgot-password` genera
 * `resetPasswordToken` + `resetPasswordTokenExpiresAt` en `users` (si el
 * correo existe) y `POST /auth/reset-password` lo valida. Token inválido o
 * vencido responde 400 (misma convención que la verificación de email; el
 * frontend no depende de 410 Gone).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  bootstrapApp,
  cleanupUsers,
  registerAndLogin,
  uniqueEmail,
  DEFAULT_PASSWORD,
} from './helpers';

describe('QK-17 Recuperar Contraseña (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let registeredEmail: string;
  const emails: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
    registeredEmail = uniqueEmail('qk17-user');
    emails.push(registeredEmail);
    await registerAndLogin(app, registeredEmail);
  });

  afterAll(async () => {
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-17-01: ante un correo registrado, envía el enlace de restablecimiento', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: registeredEmail })
      .expect(200);
  });

  it('CP-17-02: ante un correo inexistente responde con el mismo mensaje genérico', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'inexistente@comedor.org' })
      .expect(200);
  });

  it('CP-17-03: con un enlace válido, el restablecimiento actualiza la contraseña', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: registeredEmail })
      .expect(200);

    const rows: Array<{ resetPasswordToken: string }> = await dataSource.query(
      `SELECT "resetPasswordToken" FROM users WHERE email = $1`,
      [registeredEmail],
    );
    const resetToken = rows[0].resetPasswordToken;

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: resetToken,
        password: 'hornerito456',
        confirmPassword: 'hornerito456',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: registeredEmail, password: 'hornerito456' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: registeredEmail, password: DEFAULT_PASSWORD })
      .expect(401);
  });

  it('CP-17-04: un enlace vencido responde 400 (misma convención que la verificación de email)', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: registeredEmail })
      .expect(200);

    await dataSource.query(
      `UPDATE users SET "resetPasswordTokenExpiresAt" = now() - interval '1 hour' WHERE email = $1`,
      [registeredEmail],
    );

    const rows: Array<{ resetPasswordToken: string }> = await dataSource.query(
      `SELECT "resetPasswordToken" FROM users WHERE email = $1`,
      [registeredEmail],
    );
    const expiredToken = rows[0].resetPasswordToken;

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: expiredToken,
        password: 'hornerito456',
        confirmPassword: 'hornerito456',
      })
      .expect(400);
  });

  it('CP-17-05: valida la nueva contraseña y su confirmación al restablecer', async () => {
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: 'token-de-prueba',
        password: 'horne1',
        confirmPassword: 'horne1',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: 'token-de-prueba',
        password: 'hornerito456',
        confirmPassword: 'hornerito999',
      })
      .expect(400);
  });
});
