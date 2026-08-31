import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  bootstrapApp,
  cleanupOrganizations,
  cleanupUsers,
  createOrganization,
  registerAndLogin,
  uniqueEmail,
} from './sprint2/helpers';

/** Un cliente prestado al pool, del que solo nos importa devolverlo. */
interface BorrowedClient {
  release(): void;
}

/**
 * Lo mínimo del pool de `pg` que este test manipula. Se declara acá en vez de
 * importar el tipo de `pg` a propósito: es la lista explícita de internals de
 * los que dependemos, así que si una actualización de `pg` los mueve, este
 * bloque es lo único que hay que revisar. `options.max` es el que importa —
 * `_isFull()` lo lee en cada intento, y por eso el techo se puede bajar en
 * caliente.
 */
interface PoolHandle {
  idleCount: number;
  totalCount: number;
  options: { max: number };
  connect(): Promise<BorrowedClient>;
}

/**
 * `TenantContextInterceptor` toma una conexión del pool y la retiene toda la
 * request. La invariante que este archivo protege es la contracara: mientras
 * ese runner esté tomado, **nada** en la misma request puede pedirle otra
 * conexión al pool.
 *
 * Si alguien la rompe (típicamente volviendo a un `@InjectRepository` en un
 * servicio tenant-scoped), en desarrollo no se nota: el pool por defecto tiene
 * 10 conexiones y la segunda se otorga sin drama. En producción, con el pool
 * chico que impone serverless, la request espera una conexión que no se va a
 * liberar hasta que ella misma termine: deadlock, 504 a los 300s, y la
 * conexión colgada envenena la instancia para todas las requests siguientes.
 *
 * Por eso el test estrangula el pool a una sola conexión libre en runtime, en
 * vez de depender de la config: reproduce producción sin atarse a ella.
 */
describe('Deadlock del pool en requests tenant-scoped (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let pool: PoolHandle;

  const orgIds: string[] = [];
  const emails: string[] = [];

  let token: string;
  let orgId: string;
  let pendingRequestId: string;

  beforeAll(async () => {
    ({ app, dataSource } = await bootstrapApp());
    pool = (dataSource.driver as unknown as { master: PoolHandle }).master;

    const email = uniqueEmail('pool-deadlock');
    emails.push(email);

    await registerAndLogin(app, email);
    const org = await createOrganization(app, (await login(email)).token, {
      name: 'Comedor del deadlock',
    });
    orgId = org.id;
    orgIds.push(orgId);

    // El token de `registerAndLogin` se emite antes de que exista la
    // organización, así que no trae `orgId` y `TenantGuard` lo rechaza.
    token = (await login(email)).token;

    // La solicitud se crea por la vía anónima, que corre sin `TenantGuard` y
    // por lo tanto sin runner retenido: la precondición no puede consumir el
    // único slot que el caso 2 necesita libre.
    const submitted = await request(app.getHttpServer())
      .post(`/public/organizations/${orgId}/volunteer-requests`)
      .send({ name: 'Voluntaria de prueba', email: uniqueEmail('voluntaria') })
      .expect(201);
    pendingRequestId = (submitted.body as { id: string }).id;
  });

  afterAll(async () => {
    await cleanupOrganizations(dataSource, orgIds);
    await cleanupUsers(dataSource, emails);
    await app.close();
  });

  async function login(email: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password1' })
      .expect(200);
    return { token: (res.body as { accessToken: string }).accessToken };
  }

  /**
   * Espera a que el pool quede quieto: todo lo que está abierto, ocioso.
   *
   * Cuando un caso termina por `'TIMEOUT'`, la request que quedó trabada sigue
   * en vuelo y devuelve sus conexiones un rato después. Si el caso siguiente
   * estrangula el pool en ese momento, esos slots reaparecen a mitad de la
   * medición y aflojan el estrangulamiento: el deadlock deja de reproducirse y
   * el caso pasa en verde por contaminación del anterior, no porque el código
   * esté bien. Esperar acá es lo que hace a cada caso independiente.
   */
  async function waitForQuietPool(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (pool.idleCount < pool.totalCount) {
      if (Date.now() > deadline) {
        throw new Error(
          `El pool no se aquietó: ${pool.idleCount}/${pool.totalCount} ociosas`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /**
   * Deja el pool con exactamente una conexión libre mientras corre `fn`.
   *
   * Toma prestados todos los clientes ociosos y recién ahí baja el techo, así
   * el resultado no depende de cuántas conexiones haya abierto el bootstrap.
   * `pg` lee `options.max` de forma dinámica en `_isFull()`, así que el techo
   * se puede mover en caliente sin tocar la configuración de la aplicación.
   *
   * El `finally` devuelve los prestados: eso destraba la request que haya
   * quedado esperando y evita que el test termine con handles abiertos.
   */
  async function withOneFreeConnection<T>(fn: () => Promise<T>): Promise<T> {
    const held: BorrowedClient[] = [];
    const originalMax = pool.options.max;
    try {
      await waitForQuietPool();
      while (pool.idleCount > 0) {
        held.push(await pool.connect());
      }
      pool.options.max = pool.totalCount + 1;
      return await fn();
    } finally {
      pool.options.max = originalMax;
      for (const client of held) {
        client.release();
      }
    }
  }

  /**
   * Sin esta carrera, una request deadlockeada cuelga hasta el `testTimeout`
   * de 30s y el `finally` de `withOneFreeConnection` nunca corre, así que los
   * clientes prestados quedan sin devolver y arrastran al resto del archivo.
   */
  async function statusOrTimeout(
    pending: request.Test,
    ms = 5000,
  ): Promise<number | 'TIMEOUT'> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'TIMEOUT'>((resolve) => {
      timer = setTimeout(() => resolve('TIMEOUT'), ms);
    });
    try {
      return await Promise.race([pending.then((res) => res.status), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  it('resuelve GET /organization/members con una sola conexión libre', async () => {
    const status = await withOneFreeConnection(() =>
      statusOrTimeout(
        request(app.getHttpServer())
          .get('/organization/members')
          .set('Authorization', `Bearer ${token}`),
      ),
    );

    expect(status).toBe(200);
  });

  it('resuelve PATCH /volunteering/requests/:id/approve con una sola conexión libre', async () => {
    const status = await withOneFreeConnection(() =>
      statusOrTimeout(
        request(app.getHttpServer())
          .patch(`/volunteering/requests/${pendingRequestId}/approve`)
          .set('Authorization', `Bearer ${token}`),
      ),
    );

    expect(status).toBe(200);
  });
});
