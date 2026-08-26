/**
 * Contexto compartido por los escenarios de aceptación.
 *
 * No reimplementa el bootstrap: envuelve `test/sprint2/helpers.ts`, que ya
 * levanta el `AppModule` real contra Postgres y recorre el flujo verdadero de
 * registro → verificación → login. Lo que agrega es lo que un escenario
 * Gherkin necesita y un spec suelto no:
 *
 *   1. Estado entre steps. Un `Dado` crea la organización y un `Entonces`
 *      la interroga; sin un objeto que sobreviva a los tres, cada step
 *      tendría que rearmar el mundo.
 *   2. Limpieza por escenario. Se registra todo lo creado y se borra al
 *      cerrar, en vez de truncar tablas: `organizations` cascadea sobre todas
 *      las tablas del tenant, así que borrar la org se lleva sus datos y no
 *      pisa lo que otro escenario esté usando.
 *   3. Guarda contra la base equivocada (ver `assertBaseDeTest`).
 */
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  bootstrapApp,
  createOrganization,
  createPlatformAdmin,
  cleanupOrganizations,
  cleanupUsers,
  registerAndLogin,
  uniqueEmail,
  type Session,
} from '../../sprint2/helpers';

/**
 * Los escenarios borran datos. Si alguien corre la suite con la DATABASE_URL
 * de desarrollo apuntada, se lleva puesto el estado con el que estaba
 * trabajando — y peor, si alguna vez apunta a un entorno real, se lleva datos
 * de organizaciones reales. Preferimos fallar ruidosamente al arrancar.
 */
function assertBaseDeTest(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    throw new Error(
      'DATABASE_URL no está definida. Levantá la base con `npm run db:test:up` ' +
        'y exportá DATABASE_URL=postgresql://hornerito:hornerito@localhost:5433/hornerito_test',
    );
  }
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(
      `Los tests de aceptación borran datos y solo corren contra una base cuyo nombre ` +
        `termine en "_test". DATABASE_URL apunta a: ${url.replace(/:[^:@]*@/, ':***@')}`,
    );
  }
}

export class MundoDeAceptacion {
  app!: INestApplication;
  dataSource!: DataSource;

  /** Última respuesta HTTP, para que los steps `Entonces` la interroguen. */
  respuesta: request.Response | null = null;

  /** Sesiones por alias, para escenarios con más de un actor. */
  readonly sesiones = new Map<string, Session>();

  /** Bolsa libre para que los steps se pasen ids sin ensuciar la clase. */
  readonly datos = new Map<string, unknown>();

  private readonly orgIdsCreadas: string[] = [];
  private readonly emailsCreados: string[] = [];

  async iniciar(): Promise<void> {
    assertBaseDeTest();
    const { app, dataSource } = await bootstrapApp();
    this.app = app;
    this.dataSource = dataSource;
  }

  async cerrar(): Promise<void> {
    if (!this.app) return;
    // Orden importa: las organizaciones cascadean sobre las tablas del tenant,
    // los usuarios recién después (una membresía referencia a ambos).
    await cleanupOrganizations(this.dataSource, this.orgIdsCreadas);
    await cleanupUsers(this.dataSource, this.emailsCreados);
    await this.app.close();
  }

  /** Cliente HTTP contra la app levantada. */
  http() {
    return request(this.app.getHttpServer());
  }

  // --- Precondiciones de alto nivel, para los steps `Dado` -----------------

  async unUsuarioAutenticado(alias = 'usuario'): Promise<Session> {
    const email = uniqueEmail(alias);
    const sesion = await registerAndLogin(this.app, email);
    this.emailsCreados.push(email);
    this.sesiones.set(alias, sesion);
    return sesion;
  }

  async unAdminDePlataforma(alias = 'admin'): Promise<Session> {
    const email = uniqueEmail(alias);
    const sesion = await createPlatformAdmin(this.app, email);
    this.emailsCreados.push(email);
    this.sesiones.set(alias, sesion);
    return sesion;
  }

  async unaOrganizacionValidada(
    alias = 'usuario',
    overrides: Parameters<typeof createOrganization>[2] = {},
  ): Promise<{ id: string; status: string }> {
    const sesion = this.sesion(alias);
    const org = await createOrganization(this.app, sesion.token, overrides);
    this.orgIdsCreadas.push(org.id);
    this.datos.set('organizationId', org.id);
    return org;
  }

  sesion(alias = 'usuario'): Session {
    const sesion = this.sesiones.get(alias);
    if (!sesion) {
      throw new Error(
        `No hay sesión para el alias "${alias}". ¿Falta un step "Dado que existe un usuario autenticado"?`,
      );
    }
    return sesion;
  }

  /** Token del alias, ya formateado como header. */
  auth(alias = 'usuario'): string {
    return `Bearer ${this.sesion(alias).token}`;
  }

  /**
   * Registra un recurso creado por fuera de los helpers para que la limpieza
   * lo alcance igual.
   */
  registrarOrganizacion(id: string): void {
    this.orgIdsCreadas.push(id);
  }

  registrarEmail(email: string): void {
    this.emailsCreados.push(email);
  }

  /** La última respuesta, con un error claro si ningún step la seteó. */
  ultimaRespuesta(): request.Response {
    if (!this.respuesta) {
      throw new Error(
        'Ningún step ejecutó una petición HTTP todavía. ¿Falta un step "Cuando"?',
      );
    }
    return this.respuesta;
  }
}

/**
 * Azúcar para el patrón de cada archivo de steps: un mundo por escenario,
 * levantado en `beforeEach` y cerrado en `afterEach`.
 */
export function usarMundo(): () => MundoDeAceptacion {
  let mundo: MundoDeAceptacion;

  beforeEach(async () => {
    mundo = new MundoDeAceptacion();
    await mundo.iniciar();
  });

  afterEach(async () => {
    await mundo.cerrar();
  });

  return () => mundo;
}
