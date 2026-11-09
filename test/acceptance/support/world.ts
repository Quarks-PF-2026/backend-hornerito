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
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import {
  DEFAULT_PASSWORD,
  bootstrapApp,
  createOrganization,
  createPlatformAdmin,
  cleanupOrganizations,
  cleanupUsers,
  registerAndLogin,
  switchOrg,
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
    // El token de `sesion` se emitió antes de que la organización existiera,
    // así que todavía no trae `orgId` (el login solo lo completa si el
    // usuario ya tiene una única membresía activa). Los endpoints scopeados
    // a organización (TenantGuard) lo necesitan, así que refrescamos el
    // token del alias al de "cambiar de organización" apenas se crea.
    const token = await switchOrg(this.app, sesion.token, org.id);
    this.sesiones.set(alias, { ...sesion, token });
    return org;
  }

  /**
   * Da de alta un miembro con el rol dado en una organización ya creada,
   * insertando la membresía directo en la base (como hace
   * `test/sprint3/qk-33-volunteer-types.e2e-spec.ts`) y le entrega una
   * sesión con el token ya scopeado a esa organización. Para escenarios de
   * permisos: quién puede administrar según su rol.
   */
  async unMiembroConRol(
    alias: string,
    rol: 'admin' | 'coordinador' | 'voluntario',
    organizationId: string,
  ): Promise<Session> {
    const base = await this.unUsuarioAutenticado(alias);
    await this.dataSource.query(
      `INSERT INTO organization_memberships ("userId", "organizationId", role, active)
       VALUES ($1, $2, $3, true)`,
      [base.userId, organizationId, rol],
    );
    const token = await switchOrg(this.app, base.token, organizationId);
    const sesion: Session = { ...base, token };
    this.sesiones.set(alias, sesion);
    return sesion;
  }

  // --- Donaciones económicas y rankings (QK-113, QK-114, QK-115, QK-110) ---
  //
  // Los rankings se leen por persona y por organización, así que las
  // precondiciones se nombran como las dice el `.feature` ("Ana Pérez",
  // "Comedor Los Pibes") y se crean una sola vez por escenario aunque el
  // nombre aparezca en varias filas.

  /**
   * Un donante con cuenta y nombre propio. Su alias es su nombre.
   *
   * La cuenta se inserta ya verificada en vez de recorrer el registro: el
   * registro manda un mail de verificación real por cuenta, y un escenario de
   * ranking necesita una docena de donantes. Lo que se prueba acá es el
   * ranking, no el alta (eso es QK-15). El token sale igual del login real.
   */
  async unDonante(nombre: string): Promise<Session> {
    const existente = this.sesiones.get(nombre);
    if (existente) return existente;
    // El email necesita algo sin espacios ni tildes.
    const email = uniqueEmail(slug(nombre));
    hashDePrueba ??= bcrypt.hash(DEFAULT_PASSWORD, 4);
    await this.dataSource.query(
      `INSERT INTO users (name, email, "passwordHash", "emailVerified", "termsAcceptedAt")
       VALUES ($1, $2, $3, true, now())`,
      [nombre, email, await hashDePrueba],
    );
    this.emailsCreados.push(email);
    const res = await this.http()
      .post('/auth/login')
      .send({ email, password: DEFAULT_PASSWORD })
      .expect(200);
    const body = res.body as { accessToken: string; user: { id: string } };
    const sesion: Session = {
      token: body.accessToken,
      userId: body.user.id,
      email,
    };
    this.sesiones.set(nombre, sesion);
    return sesion;
  }

  /**
   * Una organización validada con datos de cobro cargados: es la que ofrece
   * "Donar dinero" en su ficha. El responsable queda con alias
   * `responsable:<nombre>` y token scopeado a ella, para confirmar donaciones.
   */
  async unaOrganizacionQueRecibeDonaciones(nombre: string): Promise<string> {
    const existente = this.datos.get(`org:${nombre}`) as string | undefined;
    if (existente) return existente;
    const alias = `responsable-${slug(nombre)}`;
    await this.unUsuarioAutenticado(alias);
    const org = await this.unaOrganizacionValidada(alias, {
      name: `${nombre} ${Date.now()}`,
    });
    await this.dataSource.query(
      `UPDATE organizations
          SET "paymentAlias" = $1, "paymentHolder" = $2, "paymentBank" = 'Banco Nación'
        WHERE id = $3`,
      [`${slug(nombre)}.${Date.now()}`, nombre, org.id],
    );
    this.datos.set(`org:${nombre}`, org.id);
    this.sesiones.set(`responsable:${nombre}`, this.sesion(alias));
    return org.id;
  }

  organizacion(nombre: string): string {
    const id = this.datos.get(`org:${nombre}`) as string | undefined;
    if (!id) throw new Error(`No existe la organización "${nombre}".`);
    return id;
  }

  /**
   * Inserta una donación económica directo en la base. Es precondición, no lo
   * que se prueba: los rankings leen donaciones ya confirmadas, y armarlas por
   * la API obliga a un declarar + confirmar por fila (con sus mails) y no deja
   * fijar la fecha de declaración, que es justo lo que miran el corte de mes y
   * el desempate.
   */
  async unaDonacionEconomica(d: {
    organizationId: string;
    amount: number;
    donorUserId: string | null;
    donorName: string | null;
    donorContact?: string | null;
    status?: 'declarada' | 'confirmada' | 'rechazada';
    isAnonymous?: boolean;
    createdAt?: Date;
  }): Promise<string> {
    const status = d.status ?? 'confirmada';
    // `donations."createdAt"` es `timestamp` sin zona y la app lo escribe con
    // `now()` en UTC. Un `Date` de JS viaja serializado en la hora local del
    // proceso y Postgres descarta el offset en un `timestamp`: en una máquina
    // en hora AR quedaría corrido tres horas. Por eso va como ISO (UTC) y se
    // convierte explícito en el SQL.
    const createdAt = (d.createdAt ?? new Date()).toISOString();
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO donations
         ("organizationId", kind, amount, status, method, "donorName", "donorContact",
          "donorUserId", "isAnonymous", "createdAt", "decidedAt", "rejectReason")
       VALUES ($1, 'economica', $2, $3, 'transferencia', $4, $5, $6, $7,
               ($8::timestamptz AT TIME ZONE 'UTC'), $9, $10)
       RETURNING id`,
      [
        d.organizationId,
        d.amount,
        status,
        d.donorName,
        d.donorContact ?? null,
        d.donorUserId,
        d.isAnonymous ?? false,
        createdAt,
        status === 'declarada' ? null : createdAt,
        status === 'rechazada' ? 'No figura en el extracto.' : null,
      ],
    );
    return rows[0].id;
  }

  /**
   * Carga la tabla `| donante | organización | monto |` de los `.feature`, con
   * columnas opcionales `estado` (confirmada · a confirmar · rechazada),
   * `anónima` (sí · no) y `fecha` (ver `fechaDeDonacion`). Por defecto:
   * confirmada, a la vista, declarada ahora.
   */
  async lasDonaciones(filas: Array<Record<string, string>>): Promise<void> {
    const estados = {
      confirmada: 'confirmada',
      'a confirmar': 'declarada',
      rechazada: 'rechazada',
    } as const;
    for (const fila of filas) {
      const donante = await this.unDonante(fila['donante']);
      const organizationId = await this.unaOrganizacionQueRecibeDonaciones(
        fila['organización'],
      );
      await this.unaDonacionEconomica({
        organizationId,
        amount: Number(fila['monto']),
        donorUserId: donante.userId,
        donorName: fila['donante'],
        donorContact: donante.email,
        status:
          estados[(fila['estado'] ?? 'confirmada') as keyof typeof estados],
        isAnonymous: fila['anónima'] === 'sí',
        createdAt: fechaDeDonacion(fila['fecha']),
      });
    }
  }

  /** `cantidad` donantes ("Donante 01"…) con montos distintos: 1000, 2000, … */
  async variosDonantes(cantidad: number, organizacion: string): Promise<void> {
    await this.lasDonaciones(
      Array.from({ length: cantidad }, (_, i) => ({
        donante: `Donante ${String(i + 1).padStart(2, '0')}`,
        organización: organizacion,
        monto: String((i + 1) * 1000),
      })),
    );
  }

  /** El responsable de la organización confirma que recibió la plata. */
  async confirmarDonacion(organizacion: string, donationId: string) {
    return this.http()
      .post(`/donations/monetary/${donationId}/confirm`)
      .set('Authorization', this.auth(`responsable:${organizacion}`))
      .expect(201);
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

/** Hash de `DEFAULT_PASSWORD`, calculado una vez por proceso (bcrypt es lento a propósito). */
let hashDePrueba: Promise<string> | undefined;

/** "Ana Pérez" → "ana-perez": apto para un email o un alias de cobro. */
function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Año y mes en curso en hora de Argentina. */
export function mesEnCursoAR(): { anio: number; mes: number } {
  const [anio, mes] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })
    .format(new Date())
    .split('-')
    .map(Number);
  return { anio, mes };
}

/**
 * Traduce la columna `fecha` de los `.feature` a un instante. Argentina es
 * UTC-3 todo el año, así que una hora AR es la hora UTC menos tres:
 * "último día del mes anterior a las 22:30" cae ya en el mes en curso si se lo
 * mira en UTC — es justo el borde que prueba el corte de mes.
 *
 *   - vacío                                     → ahora
 *   - "día N de este mes a las HH:MM"           → hora AR
 *   - "último día del mes anterior a las HH:MM" → hora AR
 *   - "mes anterior"                            → el 15 del mes anterior al mediodía AR
 */
function fechaDeDonacion(texto?: string): Date {
  if (!texto) return new Date();
  const { anio, mes } = mesEnCursoAR();
  const enAR = (dia: number, hh: number, mm: number) =>
    new Date(Date.UTC(anio, mes - 1, dia, hh + 3, mm));

  const delMes = /^día (\d+) de este mes a las (\d{2}):(\d{2})$/.exec(texto);
  if (delMes) return enAR(Number(delMes[1]), +delMes[2], +delMes[3]);

  const ultimo = /^último día del mes anterior a las (\d{2}):(\d{2})$/.exec(
    texto,
  );
  // Día 0 del mes en curso = último día del anterior (Date.UTC lo normaliza).
  if (ultimo) return enAR(0, +ultimo[1], +ultimo[2]);

  if (texto === 'mes anterior') {
    return new Date(Date.UTC(anio, mes - 2, 15, 15, 0));
  }
  throw new Error(`No sé interpretar la fecha de donación "${texto}".`);
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
