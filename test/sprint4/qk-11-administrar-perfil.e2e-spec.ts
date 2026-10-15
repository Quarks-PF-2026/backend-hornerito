/**
 * QK-11 · Administrar perfil — CP-11-01 a CP-11-10
 * Casos tal como figuran en "DOC TESTEO BACK.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `profile.controller.ts` / `profile.service.ts`
 * / `update-profile.dto.ts` / `change-password.dto.ts`:
 *   - `/profile*` está solo detrás de `JwtAuthGuard` (sin TenantGuard: el
 *     perfil es de la persona, no de una organización).
 *   - `UpdateProfileDto.name` se trimmea (`@Transform`) ANTES de
 *     `@IsNotEmpty`, así que `"   "` sí cae como nombre vacío.
 *   - `phone` distingue `undefined` (no tocar) de `null` (borrar a
 *     propósito) vía `@IsOptional()` + chequeo explícito en el service.
 *   - `ChangePasswordDto` valida primero que `newPassword === confirmNewPassword`
 *     y recién después compara `currentPassword` contra el hash — por eso
 *     CP-11-07 (no coinciden) nunca llega a evaluar la contraseña actual.
 *   - Cambiar la contraseña NO invalida los JWT ya emitidos (decisión de
 *     negocio documentada en el propio código y en el PDF, CP-11-09).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  DEFAULT_PASSWORD,
  Session,
  bootstrapApp,
  cleanupUsers,
  messagesOf,
  registerAndLogin,
  uniqueEmail,
} from './helpers';

interface ProfileBody {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  passwordHash?: string;
  isPlatformAdmin?: boolean;
}

describe('QK-11 · Administrar perfil (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const emails: string[] = [];

  function getProfile(token: string) {
    return request(app.getHttpServer())
      .get('/profile')
      .set('Authorization', `Bearer ${token}`);
  }

  function patchProfile(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch('/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function patchPassword(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch('/profile/password')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function freshUser(prefix: string): Promise<Session> {
    const email = uniqueEmail(prefix);
    emails.push(email);
    return registerAndLogin(app, email);
  }

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
  });

  afterAll(async () => {
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  it('CP-11-01: edita nombre y teléfono, la respuesta y el GET posterior reflejan el cambio', async () => {
    const user = await freshUser('cp11-01');

    const res = await patchProfile(user.token, {
      name: 'Valentina Chiapero',
      phone: '+5493531234567',
    }).expect(200);
    const body = res.body as ProfileBody;
    expect(body.name).toBe('Valentina Chiapero');
    expect(body.phone).toBe('+5493531234567');
    expect(body.passwordHash).toBeUndefined();
    expect(body.isPlatformAdmin).toBeUndefined();

    const after = await getProfile(user.token).expect(200);
    expect((after.body as ProfileBody).name).toBe('Valentina Chiapero');
    expect((after.body as ProfileBody).phone).toBe('+5493531234567');
  });

  it('CP-11-02: enviar el teléfono en null lo borra, distinto de omitirlo', async () => {
    const user = await freshUser('cp11-02');
    await patchProfile(user.token, {
      name: 'Valentina Chiapero',
      phone: '+5493531234567',
    }).expect(200);

    const res = await patchProfile(user.token, {
      name: 'Valentina Chiapero',
      phone: null,
    }).expect(200);
    expect((res.body as ProfileBody).phone).toBeNull();
    expect((res.body as ProfileBody).name).toBe('Valentina Chiapero');

    const after = await getProfile(user.token).expect(200);
    expect((after.body as ProfileBody).phone).toBeNull();
  });

  it('CP-11-03: nombre vacío o solo espacios es 400 y no modifica el perfil', async () => {
    const user = await freshUser('cp11-03');
    await patchProfile(user.token, { name: 'Nombre Original' }).expect(200);

    for (const invalidName of ['', '   ']) {
      const res = await patchProfile(user.token, {
        name: invalidName,
      }).expect(400);
      expect(messagesOf(res.body)).toContain('Ingresá tu nombre y apellido.');
    }

    const after = await getProfile(user.token).expect(200);
    expect((after.body as ProfileBody).name).toBe('Nombre Original');
  });

  it('CP-11-04: un teléfono con formato inválido es 400 y no altera el perfil', async () => {
    const user = await freshUser('cp11-04');
    await patchProfile(user.token, { name: 'Nombre Fijo' }).expect(200);

    const invalidPhones = [
      'telefono123', // letras
      '12345', // menos de 8 dígitos
      '1234567890123456', // 16 dígitos
      '+54 351 123 4567', // con espacios
    ];
    for (const phone of invalidPhones) {
      const res = await patchProfile(user.token, {
        name: 'Nombre Fijo',
        phone,
      }).expect(400);
      expect(messagesOf(res.body)).toContain(
        'El teléfono debe tener entre 8 y 15 dígitos, sin espacios ni guiones.',
      );
    }

    const after = await getProfile(user.token).expect(200);
    expect((after.body as ProfileBody).phone).toBeNull();
  });

  it('CP-11-05: cambiar la contraseña con la actual correcta habilita el login con la nueva', async () => {
    const email = uniqueEmail('cp11-05');
    emails.push(email);
    const user = await registerAndLogin(app, email);
    const newPassword = 'nuevaPass123';

    const res = await patchPassword(user.token, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword,
      confirmNewPassword: newPassword,
    }).expect(200);
    expect(messagesOf(res.body)).toContain(
      'Contraseña actualizada correctamente.',
    );

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: newPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(401);
  });

  it('CP-11-06: contraseña actual incorrecta es 400 (no 401) y no cambia nada', async () => {
    const email = uniqueEmail('cp11-06');
    emails.push(email);
    const user = await registerAndLogin(app, email);

    const res = await patchPassword(user.token, {
      currentPassword: 'incorrecta123',
      newPassword: 'otraValida123',
      confirmNewPassword: 'otraValida123',
    }).expect(400);
    expect(messagesOf(res.body)).toContain(
      'La contraseña actual es incorrecta.',
    );

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
  });

  it('CP-11-07: nueva contraseña y confirmación distintas es 400 y no aplica cambios', async () => {
    const email = uniqueEmail('cp11-07');
    emails.push(email);
    const user = await registerAndLogin(app, email);

    const res = await patchPassword(user.token, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'nueva12345',
      confirmNewPassword: 'distinta12345',
    }).expect(400);
    expect((res.body as { message: string }).message).toBe(
      'Las contraseñas no coinciden.',
    );

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
  });

  it('CP-11-08: una nueva contraseña de menos de 8 caracteres es 400', async () => {
    const email = uniqueEmail('cp11-08');
    emails.push(email);
    const user = await registerAndLogin(app, email);

    const res = await patchPassword(user.token, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword: 'corta1',
      confirmNewPassword: 'corta1',
    }).expect(400);
    expect(messagesOf(res.body)).toContain(
      'La contraseña debe tener al menos 8 caracteres.',
    );

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
  });

  it('CP-11-09: tras cambiar la contraseña, el JWT emitido antes sigue siendo válido', async () => {
    const email = uniqueEmail('cp11-09');
    emails.push(email);
    const user = await registerAndLogin(app, email); // token A
    const newPassword = 'otraNueva123';

    await patchPassword(user.token, {
      currentPassword: DEFAULT_PASSWORD,
      newPassword,
      confirmNewPassword: newPassword,
    }).expect(200);

    // El mismo token A, emitido antes del cambio, sigue autenticando.
    await getProfile(user.token).expect(200);
  });

  it('CP-11-10: acceder a cualquier endpoint de perfil sin JWT es 401', async () => {
    await request(app.getHttpServer()).get('/profile').expect(401);
    await request(app.getHttpServer())
      .patch('/profile')
      .send({ name: 'No Debería Aplicar' })
      .expect(401);
    await request(app.getHttpServer())
      .patch('/profile/password')
      .send({
        currentPassword: 'x',
        newPassword: 'yyyyyyyy',
        confirmNewPassword: 'yyyyyyyy',
      })
      .expect(401);
  });
});
