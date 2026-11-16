/**
 * QK-111 · Publicar Historias de Organización — CP-111-01 a CP-111-13
 * Casos tal como figuran en "DOC TESTEO BACK Sprint 6.pdf" (backend, capa API/DB).
 *
 * Contrato real verificado en `story.controller.ts` / `story.service.ts` /
 * `create-story.dto.ts` y en `public.service.ts` (`listStories`, `viewStory`,
 * `liveStories`):
 *   - Subida directa: `POST /stories/signature` firma un `publicId` dentro de
 *     la carpeta de la organización; el "navegador" sube a Cloudinary y
 *     `POST /stories` lee los metadatos reales con `getResource`.
 *   - Cloudinary es el simulado del repo (`fake-cloudinary.ts`): "subir" es
 *     `registrar` el recurso bajo el `publicId` firmado. Nada va a la API real.
 *   - Vencimiento perezoso: toda lectura compara `expiresAt` contra `now()`.
 *
 * Cada `it` verifica el "Resultado esperado" del doc. CP-111-04 y CP-111-05
 * describen la regla del 2026-11-08 (con sesión, el inicio oculta lo ya
 * visto); DOMAIN.md §18 la reemplazó el 2026-11-10 por "siempre todas, con
 * marca `seen`". Se dejan tal cual el doc y se reportan como observación.
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  FakeCloudinary,
  PayingOrg,
  Sandbox,
  Session,
  addMembership,
  bootstrapAppWithFakeCloudinary,
  createDonor,
  createPayingOrg,
  createPendingOrg,
  login,
  messagesOf,
  publicOrg,
  registerAndLogin,
  setOrgStatus,
  switchOrg,
  uniqueEmail,
} from './helpers';

const MB = 1024 * 1024;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface Story {
  id: string;
  mediaUrl: string;
  mediaType: string;
  durationSec: number | null;
  text: string | null;
  linkUrl: string | null;
  createdAt: string;
  expiresAt: string;
}
interface StoryGroup {
  organizationId: string;
  stories: Story[];
}
interface Archivo {
  type: 'image' | 'video';
  format: string;
  mb: number;
  duration?: number;
}

const JPG: Archivo = { type: 'image', format: 'jpg', mb: 1 };

describe('QK-111 · Publicar Historias de Organización (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let cloudinary: FakeCloudinary;
  const sandbox = new Sandbox();

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => `Bearer ${token}`;

  const org = (label: string): Promise<PayingOrg> =>
    createPayingOrg(app, sandbox, label);

  function sign(token: string, resourceType: 'image' | 'video') {
    return http()
      .post('/stories/signature')
      .set('Authorization', bearer(token))
      .send({ resourceType });
  }

  /** El "navegador" terminó de subir este archivo bajo el publicId firmado. */
  function upload(publicId: string, file: Archivo): void {
    cloudinary.registrar(publicId, file.type, {
      url: `https://res.cloudinary.com/hornerito-test/${file.type}/upload/${publicId}.${file.format}`,
      format: file.format,
      width: 1080,
      height: 1920,
      bytes: file.mb * MB,
      ...(file.duration !== undefined ? { duration: file.duration } : {}),
    });
  }

  /** Firma + subida simulada: devuelve el publicId listo para `POST /stories`. */
  async function signed(token: string, file: Archivo = JPG): Promise<string> {
    const res = await sign(token, file.type).expect(200);
    const publicId = (res.body as { publicId: string }).publicId;
    upload(publicId, file);
    return publicId;
  }

  function create(
    token: string,
    publicId: string,
    resourceType: 'image' | 'video' = 'image',
    extra: Record<string, string> = {},
  ) {
    return http()
      .post('/stories')
      .set('Authorization', bearer(token))
      .send({ publicId, resourceType, ...extra });
  }

  /** Precondición "A tiene Hn vigente": por el flujo real. */
  async function publish(token: string): Promise<Story> {
    const res = await create(token, await signed(token)).expect(201);
    return res.body as Story;
  }

  async function panel(
    token: string,
  ): Promise<{ active: Story[]; expired: Story[] }> {
    const res = await http()
      .get('/stories')
      .set('Authorization', bearer(token))
      .expect(200);
    return res.body as { active: Story[]; expired: Story[] };
  }

  /** Ids de las historias de la organización en la barra del inicio. */
  async function inicio(
    orgId: string,
    token?: string,
  ): Promise<string[] | null> {
    let req = http().get('/public/stories');
    if (token) req = req.set('Authorization', bearer(token));
    const res = await req.expect(200);
    const group = (res.body as StoryGroup[]).find(
      (g) => g.organizationId === orgId,
    );
    return group ? group.stories.map((s) => s.id) : null;
  }

  async function ficha(orgId: string): Promise<string[]> {
    const res = await publicOrg(app, orgId).expect(200);
    return (res.body.stories as Story[]).map((s) => s.id);
  }

  function view(storyId: string, token?: string) {
    let req = http().post(`/public/stories/${storyId}/view`);
    if (token) req = req.set('Authorization', bearer(token));
    return req;
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    const [{ count: n }]: Array<{ count: string }> = await dataSource.query(
      sql,
      params,
    );
    return Number(n);
  }

  const storiesOf = (orgId: string) =>
    count(`SELECT COUNT(*) AS count FROM stories WHERE "organizationId" = $1`, [
      orgId,
    ]);

  async function member(
    orgId: string,
    role: 'coordinador' | 'voluntario',
  ): Promise<Session> {
    const email = uniqueEmail(role);
    sandbox.emails.push(email);
    const base = await registerAndLogin(app, email);
    await addMembership(dataSource, base.userId, orgId, role);
    return { ...base, token: await switchOrg(app, base.token, orgId) };
  }

  beforeAll(async () => {
    ({ app, dataSource, cloudinary } = await bootstrapAppWithFakeCloudinary());
  });

  afterEach(async () => {
    await sandbox.cleanup(dataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('CP-111-01 owner publica una historia con imagen y texto, vence a los 7 días y aparece en el inicio y en la ficha', async () => {
    const a = await org('A');

    const firma = await sign(a.ownerToken, 'image');
    expect(firma.status).toBe(200);
    const publicId = (firma.body as { publicId: string }).publicId;
    expect(publicId).toContain(`/${a.id}/stories/`);
    upload(publicId, JPG);

    const res = await create(a.ownerToken, publicId, 'image', {
      text: 'Necesitamos leche',
    });
    expect(res.status).toBe(201);
    const story = res.body as Story;
    expect(story.mediaType).toBe('image');
    expect(story.text).toBe('Necesitamos leche');
    expect(
      new Date(story.expiresAt).getTime() - new Date(story.createdAt).getTime(),
    ).toBe(WEEK_MS);

    expect((await panel(a.ownerToken)).active.map((s) => s.id)).toEqual([
      story.id,
    ]);
    expect(await inicio(a.id)).toEqual([story.id]);
    expect(await ficha(a.id)).toEqual([story.id]);
  });

  it('CP-111-02 coordinador publica un video corto válido y queda registrada su duración', async () => {
    const a = await org('A');
    const coordinador = await member(a.id, 'coordinador');

    const publicId = await signed(coordinador.token, {
      type: 'video',
      format: 'mp4',
      mb: 10,
      duration: 15,
    });
    const res = await create(coordinador.token, publicId, 'video');
    expect(res.status).toBe(201);
    expect(res.body.mediaType).toBe('video');
    expect(res.body.durationSec).toBe(15);

    const home = await http().get('/public/stories').expect(200);
    const group = (home.body as StoryGroup[]).find(
      (g) => g.organizationId === a.id,
    );
    const story = group?.stories.find((s) => s.id === res.body.id);
    expect(story).toBeDefined();
    expect(story?.mediaUrl).toBe(res.body.mediaUrl);
    expect(story?.mediaUrl).toMatch(/^https:\/\//);
  });

  it('CP-111-03 texto y enlace son opcionales y el enlace tiene que ser http(s)', async () => {
    const a = await org('A');
    const [p1, p2, p3] = [
      await signed(a.ownerToken),
      await signed(a.ownerToken),
      await signed(a.ownerToken),
    ];

    const h1 = await create(a.ownerToken, p1);
    expect(h1.status).toBe(201);
    expect(h1.body.text).toBeNull();
    expect(h1.body.linkUrl).toBeNull();

    const h2 = await create(a.ownerToken, p2, 'image', {
      text: 'Sumate el sábado',
      linkUrl: 'https://comedor.org/sabado',
    });
    expect(h2.status).toBe(201);
    expect(h2.body.text).toBe('Sumate el sábado');
    expect(h2.body.linkUrl).toBe('https://comedor.org/sabado');

    const h3 = await create(a.ownerToken, p3, 'image', {
      linkUrl: 'javascript:alert(1)',
    });
    expect(h3.status).toBe(400);
    expect(messagesOf(h3.body)).toContain(
      'El enlace tiene que ser una dirección web (http o https).',
    );
    expect(await storiesOf(a.id)).toBe(2);
  });

  it('CP-111-04 en el inicio, con sesión, se oculta la historia ya vista y la organización sale de la barra cuando no le queda ninguna sin ver', async () => {
    const a = await org('A');
    const h1 = await publish(a.ownerToken);
    const h2 = await publish(a.ownerToken);
    const ana = await createDonor(app, sandbox, 'Ana');
    const bruno = await createDonor(app, sandbox, 'Bruno');

    await view(h1.id, ana.token).expect(204);
    // Repetir una vista no duplica la fila en story_views.
    await view(h1.id, ana.token).expect(204);
    expect(
      await count(
        `SELECT COUNT(*) AS count FROM story_views WHERE "storyId" = $1 AND "userId" = $2`,
        [h1.id, ana.userId],
      ),
    ).toBe(1);

    // Tras ver H1, Ana recibe el grupo de A solo con H2.
    expect(await inicio(a.id, ana.token)).toEqual([h2.id]);

    // Tras ver H2, A ya no aparece para Ana.
    await view(h2.id, ana.token).expect(204);
    expect(await inicio(a.id, ana.token)).toBeNull();

    // Bruno sigue viendo a A con H1 y H2.
    expect(await inicio(a.id, bruno.token)).toEqual([h1.id, h2.id]);
  });

  it('CP-111-05 la ficha de la organización muestra todas las vigentes, incluso las ya vistas', async () => {
    const a = await org('A');
    const h1 = await publish(a.ownerToken);
    const ana = await createDonor(app, sandbox, 'Ana');
    await view(h1.id, ana.token).expect(204);

    // La ficha de A sí trae H1 en `stories`.
    expect(await ficha(a.id)).toEqual([h1.id]);
    // El inicio no muestra H1 para Ana.
    expect((await inicio(a.id, ana.token)) ?? []).not.toContain(h1.id);
  });

  it('CP-111-06 vencimiento perezoso a los 7 días: sale del público y pasa al historial del panel, sin borrarse', async () => {
    const a = await org('A');
    const h1 = await publish(a.ownerToken);
    const h2 = await publish(a.ownerToken);
    await dataSource.query(
      `UPDATE stories SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`,
      [h1.id],
    );

    expect(await inicio(a.id)).toEqual([h2.id]);
    expect(await ficha(a.id)).toEqual([h2.id]);

    const lists = await panel(a.ownerToken);
    expect(lists.expired.map((s) => s.id)).toEqual([h1.id]);
    expect(lists.active.map((s) => s.id)).toEqual([h2.id]);

    const rows: Array<{ deletedAt: Date | null }> = await dataSource.query(
      `SELECT "deletedAt" FROM stories WHERE id = $1`,
      [h1.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeNull();
  });

  it('CP-111-07 rechaza un archivo fuera de formato, tamaño o duración, sin publicar y borrándolo de Cloudinary', async () => {
    const a = await org('A');
    const casos: Array<{ file: Archivo; message?: string }> = [
      {
        file: { type: 'image', format: 'gif', mb: 1 },
        message: 'El formato del archivo tiene que ser JPG, PNG o WebP.',
      },
      {
        file: { type: 'image', format: 'jpg', mb: 9 },
        message: 'La imagen no puede superar los 8 MB.',
      },
      {
        file: { type: 'video', format: 'mp4', mb: 5, duration: 35 },
        message: 'El video no puede durar más de 30 segundos.',
      },
      {
        file: { type: 'video', format: 'webm', mb: 25, duration: 10 },
        message: 'El video no puede superar los 20 MB.',
      },
      // Video sin duración informada: el doc pide 400 pero no fija el mensaje.
      { file: { type: 'video', format: 'mp4', mb: 5 } },
    ];

    for (const { file, message } of casos) {
      const publicId = await signed(a.ownerToken, file);
      const res = await create(a.ownerToken, publicId, file.type);
      expect(res.status).toBe(400);
      if (message) expect(messagesOf(res.body)).toContain(message);
      expect(cloudinary.destruidos).toContainEqual({
        publicId,
        resourceType: file.type,
      });
    }

    const lists = await panel(a.ownerToken);
    expect(lists.active).toEqual([]);
    expect(lists.expired).toEqual([]);
    expect(await storiesOf(a.id)).toBe(0);
  });

  it('CP-111-08 un voluntario no puede firmar, publicar ni eliminar historias y sin sesión el panel no responde', async () => {
    const a = await org('A');
    const h1 = await publish(a.ownerToken);
    const publicId = await signed(a.ownerToken);
    const voluntario = await member(a.id, 'voluntario');
    const auth = bearer(voluntario.token);

    const intentos = [
      await http()
        .post('/stories/signature')
        .set('Authorization', auth)
        .send({ resourceType: 'image' }),
      await create(voluntario.token, publicId),
      await http().delete(`/stories/${h1.id}`).set('Authorization', auth),
    ];
    for (const res of intentos) {
      expect(res.status).toBe(403);
      expect(messagesOf(res.body)).toContain(
        'No tenés permisos para esta acción.',
      );
    }

    // No se creó ni se eliminó nada.
    expect((await panel(a.ownerToken)).active.map((s) => s.id)).toEqual([
      h1.id,
    ]);
    expect(await storiesOf(a.id)).toBe(1);

    await http().get('/stories').expect(401);
  });

  it('CP-111-09 tope de 20 historias vigentes por organización; eliminar una libera lugar', async () => {
    const a = await org('A');
    const seeded: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO stories
         ("organizationId", "createdByUserId", "mediaUrl", "mediaPublicId", "mediaType", "createdAt", "expiresAt")
       SELECT $1::uuid, $2::uuid,
              'https://res.cloudinary.com/hornerito-test/image/upload/seed-' || g || '.jpg',
              'seed/' || $1::text || '/' || g,
              'image', now(), now() + interval '7 days'
         FROM generate_series(1, 20) g
       RETURNING id`,
      [a.id, a.ownerId],
    );
    expect((await panel(a.ownerToken)).active).toHaveLength(20);

    const llena = await sign(a.ownerToken, 'image');
    expect(llena.status).toBe(400);
    expect(messagesOf(llena.body)).toContain(
      'La organización ya tiene 20 historias vigentes: eliminá una para publicar otra.',
    );

    await http()
      .delete(`/stories/${seeded[0].id}`)
      .set('Authorization', bearer(a.ownerToken))
      .expect(204);

    const firma = await sign(a.ownerToken, 'image');
    expect(firma.status).toBe(200);
    const publicId = (firma.body as { publicId: string }).publicId;
    upload(publicId, JPG);
    const alta = await create(a.ownerToken, publicId);
    expect(alta.status).toBe(201);

    expect((await panel(a.ownerToken)).active).toHaveLength(20);
  });

  it('CP-111-10 eliminar una historia la saca de todas las vistas y conserva el registro (borrado lógico)', async () => {
    const a = await org('A');
    const h1 = await publish(a.ownerToken);
    const borrar = () =>
      http()
        .delete(`/stories/${h1.id}`)
        .set('Authorization', bearer(a.ownerToken));

    expect((await borrar()).status).toBe(204);

    const lists = await panel(a.ownerToken);
    expect([...lists.active, ...lists.expired].map((s) => s.id)).not.toContain(
      h1.id,
    );
    expect(await inicio(a.id)).toBeNull();
    expect(await ficha(a.id)).toEqual([]);

    const rows: Array<{ deletedAt: Date | null }> = await dataSource.query(
      `SELECT "deletedAt" FROM stories WHERE id = $1`,
      [h1.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).not.toBeNull();

    const segundo = await borrar();
    expect(segundo.status).toBe(404);
    expect(messagesOf(segundo.body)).toContain('La historia no existe.');
  });

  it('CP-111-11 aislamiento: cada organización solo ve y elimina sus historias y no publica con un archivo de otra', async () => {
    const a = await org('A');
    const b = await org('B');
    const h1 = await publish(a.ownerToken);
    const publicIdDeA = await signed(a.ownerToken);

    expect(await panel(b.ownerToken)).toEqual({ active: [], expired: [] });

    await http()
      .delete(`/stories/${h1.id}`)
      .set('Authorization', bearer(b.ownerToken))
      .expect(404);
    expect((await panel(a.ownerToken)).active.map((s) => s.id)).toEqual([
      h1.id,
    ]);

    const ajeno = await create(b.ownerToken, publicIdDeA);
    expect(ajeno.status).toBe(400);
    expect(messagesOf(ajeno.body)).toContain(
      'El archivo no corresponde a esta organización.',
    );
    // No se toca el archivo de A.
    expect(cloudinary.destruidos.map((d) => d.publicId)).not.toContain(
      publicIdDeA,
    );
    expect(await storiesOf(b.id)).toBe(0);
  });

  it('CP-111-12 un visitante sin cuenta ve todas las vigentes y no se le registran vistas', async () => {
    const a = await org('A');
    const h1 = await publish(a.ownerToken);
    const h2 = await publish(a.ownerToken);

    await view(h1.id).expect(204);

    expect(await count(`SELECT COUNT(*) AS count FROM story_views`, [])).toBe(
      0,
    );
    expect(await inicio(a.id)).toEqual([h1.id, h2.id]);
  });

  it('CP-111-13 solo las organizaciones validadas publican historias y aparecen en el inicio', async () => {
    const pEmail = uniqueEmail('owner-p');
    sandbox.emails.push(pEmail);
    const p = await createPendingOrg(app, pEmail);
    sandbox.orgIds.push(p.id);
    // El token previo a crear la organización no trae orgId: con una única
    // membresía activa, el login lo completa.
    const ownerP = await login(app, pEmail);

    const firma = await sign(ownerP.token, 'image');
    expect(firma.status).toBe(403);
    expect(messagesOf(firma.body)).toContain(
      'La organización no está habilitada.',
    );

    const a = await org('A');
    const h1 = await publish(a.ownerToken);
    expect(await inicio(a.id)).toEqual([h1.id]);

    await setOrgStatus(dataSource, a.id, 'pending');
    expect(await inicio(a.id)).toBeNull();
  });
});
