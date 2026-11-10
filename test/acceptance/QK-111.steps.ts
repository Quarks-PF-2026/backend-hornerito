import { randomUUID } from 'crypto';
import { autoBindSteps, loadFeature, StepDefinitions } from 'jest-cucumber';
import type { Response } from 'supertest';
import { usarMundo } from './support/world';
import type { RecursoEnCloudinary } from './support/fake-cloudinary';

/**
 * Este `.feature` reusa las mismas frases en muchos escenarios (quién ve qué
 * en el inicio, el perfil y el panel), así que se enlaza con `autoBindSteps`:
 * cada frase se define una sola vez y jest-cucumber la busca por texto, en vez
 * de repetir el mismo step en 18 bloques `test(...)`.
 */
const feature = loadFeature('./test/acceptance/QK-111.feature');
const mundo = usarMundo();

interface Historia {
  id: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  durationSec: number | null;
  text: string | null;
  linkUrl: string | null;
  createdAt: string;
  expiresAt: string;
  /** Solo en la barra del inicio: si quien mira ya la vio (el visitante, nunca). */
  seen?: boolean;
}

interface OrgEnLaBarra {
  organizationId: string;
  organizationName: string;
  organizationLogoUrl: string | null;
  stories: Historia[];
}

type Orden = 'primera' | 'segunda' | 'nueva';

const VISITANTE = 'un visitante sin cuenta';
/** Un actor del `.feature`: el visitante sin cuenta o una persona de nombre y apellido. */
const ACTOR = `(${VISITANTE}|[^ ,]+ [^ ,]+)`;
const MB = 1024 * 1024;

// --- Helpers de lectura sobre el mundo ---------------------------------------

const historias = (org: string): string[] =>
  (mundo().datos.get(`historias:${org}`) as string[] | undefined) ?? [];

const historia = (org: string, orden: Orden): string => {
  if (orden === 'nueva') {
    const id = mundo().datos.get('nueva') as string | undefined;
    if (!id)
      throw new Error(
        'No se publicó ninguna historia nueva en este escenario.',
      );
    return id;
  }
  const id = historias(org)[orden === 'primera' ? 0 : 1];
  if (!id) throw new Error(`${org} no tiene ${orden} historia.`);
  return id;
};

/** Header de autorización del actor; el visitante no manda ninguno. */
const conSesion = <T extends { set(h: string, v: string): T }>(
  req: T,
  actor: string,
): T =>
  actor === VISITANTE ? req : req.set('Authorization', mundo().auth(actor));

const inicio = async (actor: string): Promise<OrgEnLaBarra[]> => {
  const res = await conSesion(mundo().http().get('/public/stories'), actor);
  expect(res.status).toBe(200);
  return res.body as OrgEnLaBarra[];
};

const perfil = async (org: string, actor: string): Promise<Historia[]> => {
  const res = await conSesion(
    mundo()
      .http()
      .get(`/public/organizations/${mundo().organizacion(org)}`),
    actor,
  );
  expect(res.status).toBe(200);
  return (res.body as { stories: Historia[] }).stories;
};

const panel = async (
  org: string,
): Promise<{ active: Historia[]; expired: Historia[] }> => {
  const res = await mundo()
    .http()
    .get('/stories')
    .set('Authorization', mundo().auth(`responsable:${org}`));
  expect(res.status).toBe(200);
  return res.body as { active: Historia[]; expired: Historia[] };
};

const ids = (lista: Historia[]) => lista.map((h) => h.id);

// --- Publicar ----------------------------------------------------------------

/**
 * "una imagen JPG de 2 MB", "un video MP4 de 25 segundos y 15 MB", con
 * `, el texto "..."` y/o `y el enlace "..."` opcionales al final.
 */
function parsearArchivo(texto: string) {
  const m =
    /^(una imagen|un video) (\w+) de (?:(\d+) segundos y )?(\d+) MB(?:,? (?:y )?el texto "([^"]*)")?(?:,? (?:y )?el enlace "([^"]*)")?$/.exec(
      texto,
    );
  if (!m) throw new Error(`No sé interpretar el archivo "${texto}".`);
  return {
    tipo: m[1] === 'una imagen' ? ('image' as const) : ('video' as const),
    formato: m[2].toLowerCase(),
    duracion: m[3] ? Number(m[3]) : undefined,
    megas: Number(m[4]),
    texto: m[5],
    enlace: m[6],
  };
}

/**
 * Recorre el flujo real de subida directa: pide la firma, "sube" el archivo a
 * Cloudinary (el fake lo registra bajo el `publicId` firmado) y publica. Si la
 * firma se rechaza, publica igual con un `publicId` inventado: así se prueba
 * que el alta en sí también rechaza, no solo la firma.
 */
async function publicar(
  actor: string,
  org: string,
  archivo: string,
): Promise<Response> {
  const a = parsearArchivo(archivo);
  const auth = mundo().auth(actor);
  const firma = await mundo()
    .http()
    .post('/stories/signature')
    .set('Authorization', auth)
    .send({ resourceType: a.tipo });
  mundo().datos.set('firma', firma);
  const publicId =
    (firma.body as { publicId?: string })?.publicId ??
    `hornerito/stories/sin-firma-${randomUUID()}`;

  const recurso: Omit<RecursoEnCloudinary, 'publicId'> = {
    url: `https://res.cloudinary.com/hornerito-test/${a.tipo}/upload/${publicId}.${a.formato}`,
    format: a.formato,
    width: 1080,
    height: 1920,
    bytes: a.megas * MB,
    ...(a.duracion !== undefined ? { duration: a.duracion } : {}),
  };
  mundo().cloudinary.registrar(publicId, a.tipo, recurso);
  mundo().datos.set('recurso', recurso);

  const res = await mundo()
    .http()
    .post('/stories')
    .set('Authorization', auth)
    .send({
      publicId,
      resourceType: a.tipo,
      ...(a.texto !== undefined ? { text: a.texto } : {}),
      ...(a.enlace !== undefined ? { linkUrl: a.enlace } : {}),
    });
  mundo().respuesta = res;
  if (res.status === 201) {
    const id = (res.body as Historia).id;
    mundo().datos.set(`historias:${org}`, [...historias(org), id]);
    mundo().datos.set('nueva', id);
  }
  return res;
}

/** El actor de "el responsable de X publica…" o "Carla Gómez intenta publicar…". */
function actorYOrg(quien: string): { actor: string; org: string } {
  const responsable = /^el responsable de (.*)$/.exec(quien);
  if (responsable)
    return { actor: `responsable:${responsable[1]}`, org: responsable[1] };
  return { actor: quien, org: mundo().datos.get(`orgDe:${quien}`) as string };
}

async function verHistoria(actor: string, org: string, orden: Orden) {
  const res = await conSesion(
    mundo()
      .http()
      .post(`/public/stories/${historia(org, orden)}/view`),
    actor,
  );
  expect(res.status).toBe(204);
}

// --- Steps --------------------------------------------------------------------

const steps: StepDefinitions = ({ given, when, then }) => {
  given(/^que (.*) es una organización validada$/, async (org: string) => {
    await mundo().unaOrganizacionQueRecibeDonaciones(org);
  });

  given(
    /^que (.*) publicó (\d+) historias?$/,
    async (org: string, n: string) => {
      await mundo().unaOrganizacionQueRecibeDonaciones(org);
      for (let i = 0; i < Number(n); i++) {
        const res = await publicar(
          `responsable:${org}`,
          org,
          'una imagen JPG de 1 MB',
        );
        expect(res.status).toBe(201);
      }
    },
  );

  given(/^que (.*) tiene cuenta$/, async (nombre: string) => {
    await mundo().unDonante(nombre);
  });

  given(
    /^que (.*) es voluntaria de (.*)$/,
    async (nombre: string, org: string) => {
      await mundo().unMiembroConRol(
        nombre,
        'voluntario',
        mundo().organizacion(org),
      );
      mundo().datos.set(`orgDe:${nombre}`, org);
    },
  );

  given(
    /^que pasaron 7 días desde la (primera|segunda) historia de (.*)$/,
    async (orden: Orden, org: string) => {
      await mundo().dataSource.query(
        `UPDATE stories SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`,
        [historia(org, orden)],
      );
    },
  );

  given(/^que (.*) quedó pendiente de validación$/, async (org: string) => {
    await mundo().dataSource.query(
      `UPDATE organizations SET status = 'pending' WHERE id = $1`,
      [mundo().organizacion(org)],
    );
  });

  when(
    /^(el responsable de .*|[^ ]+ [^ ]+) (?:publica|intenta publicar) una historia con (.*)$/,
    async (quien: string, archivo: string) => {
      const { actor, org } = actorYOrg(quien);
      await publicar(actor, org, archivo);
    },
  );

  when(
    new RegExp(
      `^${ACTOR} (?:mira|abre) la (primera|segunda) historia de (.*) (?:en el inicio|desde su perfil)$`,
    ),
    (actor: string, orden: Orden, org: string) =>
      verHistoria(actor, org, orden),
  );

  when(
    /^el responsable de (.*) elimina la (primera|segunda) historia$/,
    async (org: string, orden: Orden) => {
      const res = await mundo()
        .http()
        .delete(`/stories/${historia(org, orden)}`)
        .set('Authorization', mundo().auth(`responsable:${org}`));
      expect(res.status).toBe(204);
    },
  );

  when(
    /^el responsable de (.*) intenta eliminar la (primera|segunda) historia de (.*)$/,
    async (org: string, orden: Orden, otraOrg: string) => {
      mundo().respuesta = await mundo()
        .http()
        .delete(`/stories/${historia(otraOrg, orden)}`)
        .set('Authorization', mundo().auth(`responsable:${org}`));
    },
  );

  then(/^la historia queda publicada(.*)$/, (detalle: string) => {
    const res = mundo().ultimaRespuesta();
    expect(res.status).toBe(201);
    const h = res.body as Historia;
    const recurso = mundo().datos.get('recurso') as RecursoEnCloudinary;
    expect(h.mediaUrl).toBe(recurso.url);

    const video = /^ como un video de (\d+) segundos$/.exec(detalle);
    const imagenYTexto = /^ con la imagen(?: y el texto "(.*)")?$/.exec(
      detalle,
    );
    const textoYEnlace = /^ con el texto "(.*)" y el enlace "(.*)"$/.exec(
      detalle,
    );
    if (video) {
      expect(h.mediaType).toBe('video');
      expect(h.durationSec).toBe(Number(video[1]));
    } else if (imagenYTexto) {
      expect(h.mediaType).toBe('image');
      if (imagenYTexto[1] !== undefined) expect(h.text).toBe(imagenYTexto[1]);
    } else if (detalle === ' sin texto ni enlace') {
      expect(h.text ?? null).toBeNull();
      expect(h.linkUrl ?? null).toBeNull();
    } else if (textoYEnlace) {
      expect(h.text).toBe(textoYEnlace[1]);
      expect(h.linkUrl).toBe(textoYEnlace[2]);
    } else {
      throw new Error(
        `No sé verificar "la historia queda publicada${detalle}".`,
      );
    }
  });

  then(/^vence (\d+) días después de publicada$/, (dias: string) => {
    const h = mundo().ultimaRespuesta().body as Historia;
    const creada = new Date(h.createdAt).getTime();
    const vence = new Date(h.expiresAt).getTime();
    expect(Math.abs(Date.now() - creada)).toBeLessThan(60_000);
    expect(Math.abs(vence - creada - Number(dias) * 86_400_000)).toBeLessThan(
      5_000,
    );
  });

  then(
    /^el sistema rechaza la historia con un mensaje que menciona "(.*)"$/,
    (motivo: string) => {
      const res = mundo().ultimaRespuesta();
      expect([400, 409]).toContain(res.status);
      const mensaje = [
        (res.body as { message?: string | string[] }).message ?? '',
      ]
        .flat()
        .join(' ');
      // Sin espacios ni mayúsculas: "8 MB" y "8MB" dicen lo mismo.
      const normalizar = (s: string) => s.toLowerCase().replace(/\s+/g, '');
      expect(normalizar(mensaje)).toContain(normalizar(motivo));
    },
  );

  then(/^el sistema no le permite publicarla$/, () => {
    expect((mundo().datos.get('firma') as Response).status).toBe(403);
    expect(mundo().ultimaRespuesta().status).toBe(403);
  });

  then(/^el sistema le responde que esa historia no existe$/, () => {
    expect(mundo().ultimaRespuesta().status).toBe(404);
  });

  then(
    new RegExp(
      `^en el inicio, ${ACTOR} (ve|no ve) la (primera|segunda|nueva) historia de (.*?)(?: (marcada como vista|sin ver))?$`,
    ),
    async (
      actor: string,
      verbo: string,
      orden: Orden,
      org: string,
      marca?: string,
    ) => {
      const id = historia(org, orden);
      const enLaBarra = (await inicio(actor)).flatMap((o) => o.stories);
      const vista = enLaBarra.find((h) => h.id === id);
      if (verbo === 'no ve') return expect(vista).toBeUndefined();
      expect(vista).toBeDefined();
      if (marca) expect(vista!.seen).toBe(marca === 'marcada como vista');
    },
  );

  then(
    new RegExp(
      `^en el inicio, ${ACTOR} ve a (.*) con (\\d+) historias? sin ver$`,
    ),
    async (actor: string, org: string, n: string) => {
      const enLaBarra = (await inicio(actor)).find(
        (o) => o.organizationId === mundo().organizacion(org),
      );
      expect(enLaBarra).toBeDefined();
      expect(enLaBarra!.stories.filter((h) => !h.seen)).toHaveLength(Number(n));
    },
  );

  then(
    new RegExp(`^en el inicio, ${ACTOR} ve a (.*) antes que a (.*)$`),
    async (actor: string, primera: string, despues: string) => {
      const orgs = (await inicio(actor)).map((o) => o.organizationId);
      const a = orgs.indexOf(mundo().organizacion(primera));
      const b = orgs.indexOf(mundo().organizacion(despues));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThan(a);
    },
  );

  then(
    new RegExp(`^en el inicio, ${ACTOR} no ve a (.*)$`),
    async (actor: string, org: string) => {
      const orgs = (await inicio(actor)).map((o) => o.organizationId);
      expect(orgs).not.toContain(mundo().organizacion(org));
    },
  );

  then(
    new RegExp(
      `^en el perfil de (.*?), ${ACTOR} (ve|no ve) la (primera|segunda|nueva) historia$`,
    ),
    async (org: string, actor: string, verbo: string, orden: Orden) => {
      const visibles = ids(await perfil(org, actor));
      if (verbo === 've') expect(visibles).toContain(historia(org, orden));
      else expect(visibles).not.toContain(historia(org, orden));
    },
  );

  then(
    /^en el panel de (.*?), la (primera|segunda|nueva) historia (figura vigente|figura en el historial de vencidas|ya no figura)$/,
    async (org: string, orden: Orden, estado: string) => {
      const { active, expired } = await panel(org);
      const id = historia(org, orden);
      if (estado === 'figura vigente') {
        expect(ids(active)).toContain(id);
        expect(ids(expired)).not.toContain(id);
      } else if (estado === 'ya no figura') {
        expect([...ids(active), ...ids(expired)]).not.toContain(id);
      } else {
        expect(ids(expired)).toContain(id);
        expect(ids(active)).not.toContain(id);
      }
    },
  );

  then(
    /^en el panel de (.*) figuran (\d+) historias vigentes$/,
    async (org: string, n: string) => {
      expect((await panel(org)).active).toHaveLength(Number(n));
    },
  );

  then(
    /^en el panel de (.*?) figura solo la (primera|segunda) historia de (.*)$/,
    async (org: string, orden: Orden, propia: string) => {
      const { active, expired } = await panel(org);
      expect([...ids(active), ...ids(expired)]).toEqual([
        historia(propia, orden),
      ]);
    },
  );

  then(
    /^queda registro de la (primera|segunda) historia de (.*)$/,
    async (orden: Orden, org: string) => {
      const filas: Array<{ deletedAt: Date | null }> =
        await mundo().dataSource.query(
          `SELECT "deletedAt" FROM stories WHERE id = $1`,
          [historia(org, orden)],
        );
      expect(filas).toHaveLength(1);
      expect(filas[0].deletedAt).not.toBeNull();
    },
  );

  then(
    /^no quedó registrada ninguna vista de las historias de (.*)$/,
    async (org: string) => {
      const [{ n }]: Array<{ n: number }> = await mundo().dataSource.query(
        `SELECT count(*)::int AS n FROM story_views WHERE "organizationId" = $1`,
        [mundo().organizacion(org)],
      );
      expect(n).toBe(0);
    },
  );
};

autoBindSteps(feature, [steps]);
