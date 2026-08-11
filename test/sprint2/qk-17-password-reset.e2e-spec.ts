/**
 * QK-17 · Recuperar Contraseña — CP-17-01 a CP-17-05
 * Casos tal como figuran en "Documentación del sprint 2 - Equipo 14.pdf".
 *
 * Estado real: no existe implementación de recuperación de contraseña en el
 * backend. No hay controller ni ruta bajo `/auth` (ni ningún otro módulo)
 * para "olvidé mi contraseña" o "restablecer contraseña" — se verificó con
 * `grep -rniE "forgot|reset-password" src` sin resultados. Tampoco existe en
 * el frontend.
 *
 * Estos 5 casos ejercitan las rutas que el flujo del PDF requeriría
 * (`/auth/forgot-password`, `/auth/reset-password`). Al no existir, Nest
 * responde 404 y cada test falla contra el resultado esperado del PDF —
 * eso es intencional: es la evidencia formal de que QK-17 no está
 * implementada.
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
    // No hay forma de obtener un token de restablecimiento real: el paso
    // previo (CP-17-01) no existe. Se prueba directamente contra la ruta de
    // restablecimiento que el flujo del PDF requeriría.
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: 'token-de-prueba',
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

  it('CP-17-04: un enlace vencido informa la expiración y permite pedir uno nuevo', async () => {
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: 'token-vencido',
        password: 'hornerito456',
        confirmPassword: 'hornerito456',
      })
      .expect(410); // Gone, como usa el resto del código para invitaciones vencidas.
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