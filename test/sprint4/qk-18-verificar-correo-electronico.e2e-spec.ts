/**
 * QK-18 · Verificar correo electrónico — CP-18-01 a CP-18-08
 * Casos tal como figuran en "DOC TESTEO BACK.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `auth.controller.ts` / `auth.service.ts`:
 *   - `POST /auth/register` → 201 `{ email }`. Nace `emailVerified: false`
 *     con un `verificationToken` (UUID) y TTL de 24h.
 *   - `GET /auth/verify?token=` → 200 y limpia el token; inexistente o ya
 *     usado → 400 "El enlace de verificación no es válido."; vencido → 400
 *     "El enlace de verificación expiró." (sin limpiar nada en ese caso).
 *   - `POST /auth/resend-verification` reusa `ForgotPasswordDto` (`{email}`)
 *     y SIEMPRE responde 200 con el mismo mensaje genérico, exista o no la
 *     cuenta y esté o no ya verificada — solo genera token/envía correo si
 *     existe y sigue sin verificar.
 *   - `POST /auth/login` sobre una cuenta sin verificar → 401 con
 *     `{ message, unverified: true }`, sin `accessToken`.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { VerificationMailService } from '../../src/modules/auth/mail/verification-mail.service';
import {
  DEFAULT_PASSWORD,
  bootstrapApp,
  cleanupUsers,
  expireVerificationToken,
  getUserTokenRow,
  rawRegister,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

const NIL_TOKEN = '00000000-0000-0000-0000-000000000000';

describe('QK-18 · Verificar correo electrónico (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const emails: string[] = [];

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterAll(async () => {
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-18-01: un token válido y vigente activa la cuenta y habilita el login', async () => {
    const email = uniqueEmail('cp18-01');
    emails.push(email);

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        name: 'Valentina Chiapero',
        email,
        password: DEFAULT_PASSWORD,
        confirmPassword: DEFAULT_PASSWORD,
        acceptedTerms: true,
      })
      .expect(201);
    expect((registerRes.body as { email: string }).email).toBe(email);

    const before = await getUserTokenRow(dataSource, email);
    expect(before.emailVerified).toBe(false);
    expect(before.verificationToken).toBeTruthy();
    const hoursToExpiry =
      (before.verificationTokenExpiresAt!.getTime() - Date.now()) /
      (60 * 60 * 1000);
    expect(hoursToExpiry).toBeGreaterThan(23);
    expect(hoursToExpiry).toBeLessThanOrEqual(24);

    await request(app.getHttpServer())
      .get('/auth/verify')
      .query({ token: before.verificationToken })
      .expect(200);

    const after = await getUserTokenRow(dataSource, email);
    expect(after.emailVerified).toBe(true);
    expect(after.verificationToken).toBeNull();
    expect(after.verificationTokenExpiresAt).toBeNull();

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    expect((loginRes.body as { accessToken: string }).accessToken).toEqual(
      expect.any(String),
    );
  });

  it('CP-18-02: un token inexistente o malformado es rechazado con 400 y no verifica nada', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/verify')
      .query({ token: NIL_TOKEN })
      .expect(400);
    expect((res.body as { message: string }).message).toBe(
      'El enlace de verificación no es válido.',
    );
  });

  it('CP-18-03: un token vencido (>24h) es rechazado con 400 y la cuenta sigue sin verificar', async () => {
    const email = uniqueEmail('cp18-03');
    emails.push(email);
    await rawRegister(app, email);
    const { verificationToken } = await getUserTokenRow(dataSource, email);

    await expireVerificationToken(dataSource, email);

    const res = await request(app.getHttpServer())
      .get('/auth/verify')
      .query({ token: verificationToken })
      .expect(400);
    expect((res.body as { message: string }).message).toBe(
      'El enlace de verificación expiró.',
    );

    const after = await getUserTokenRow(dataSource, email);
    expect(after.emailVerified).toBe(false);
    // El token vencido no se limpia: el service tira antes de tocar nada.
    expect(after.verificationToken).toBe(verificationToken);
  });

  it('CP-18-04: reutilizar un token ya consumido devuelve 400 y no rompe la cuenta ya verificada', async () => {
    const email = uniqueEmail('cp18-04');
    emails.push(email);
    await rawRegister(app, email);
    const { verificationToken } = await getUserTokenRow(dataSource, email);

    await request(app.getHttpServer())
      .get('/auth/verify')
      .query({ token: verificationToken })
      .expect(200);

    // Segundo clic con el mismo enlace: el token ya no existe en la base.
    const res = await request(app.getHttpServer())
      .get('/auth/verify')
      .query({ token: verificationToken })
      .expect(400);
    expect((res.body as { message: string }).message).toBe(
      'El enlace de verificación no es válido.',
    );

    const after = await getUserTokenRow(dataSource, email);
    expect(after.emailVerified).toBe(true);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
  });

  it('CP-18-05: el reenvío genera un token nuevo e invalida el anterior', async () => {
    const email = uniqueEmail('cp18-05');
    emails.push(email);
    await rawRegister(app, email);
    const { verificationToken: tokenA } = await getUserTokenRow(
      dataSource,
      email,
    );

    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email })
      .expect(200);

    const { verificationToken: tokenB } = await getUserTokenRow(
      dataSource,
      email,
    );
    expect(tokenB).toBeTruthy();
    expect(tokenB).not.toBe(tokenA);

    await request(app.getHttpServer())
      .get('/auth/verify')
      .query({ token: tokenA })
      .expect(400);

    await request(app.getHttpServer())
      .get('/auth/verify')
      .query({ token: tokenB })
      .expect(200);

    const after = await getUserTokenRow(dataSource, email);
    expect(after.emailVerified).toBe(true);
  });

  it('CP-18-06: reenviar sobre una cuenta ya verificada responde 200 genérico sin generar token ni enviar correo', async () => {
    const email = uniqueEmail('cp18-06');
    emails.push(email);
    await registerAndLogin(app, email); // deja la cuenta verificada

    const mailSpy = jest.spyOn(
      app.get(VerificationMailService),
      'send',
    );
    mailSpy.mockClear();

    const res = await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email })
      .expect(200);
    expect((res.body as { message: string }).message).toBe(
      'Si el correo está registrado y sin verificar, te enviamos un nuevo enlace.',
    );
    expect(mailSpy).not.toHaveBeenCalled();

    const after = await getUserTokenRow(dataSource, email);
    expect(after.verificationToken).toBeNull();

    mailSpy.mockRestore();
  });

  it('CP-18-07: reenviar para un correo inexistente responde el mismo 200 genérico (anti-enumeración)', async () => {
    const mailSpy = jest.spyOn(
      app.get(VerificationMailService),
      'send',
    );
    mailSpy.mockClear();

    const res = await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: 'noexiste-cp18-07@test.com' })
      .expect(200);
    expect((res.body as { message: string }).message).toBe(
      'Si el correo está registrado y sin verificar, te enviamos un nuevo enlace.',
    );
    expect(mailSpy).not.toHaveBeenCalled();

    mailSpy.mockRestore();
  });

  it('CP-18-08: iniciar sesión con una cuenta sin verificar es rechazado con 401 y unverified:true', async () => {
    const email = uniqueEmail('cp18-08');
    emails.push(email);
    await rawRegister(app, email);

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(401);

    const body = res.body as { message: string; unverified: boolean };
    expect(body.message).toBe('Verificá tu cuenta antes de iniciar sesión.');
    expect(body.unverified).toBe(true);
    expect((res.body as { accessToken?: string }).accessToken).toBeUndefined();
  });
});
