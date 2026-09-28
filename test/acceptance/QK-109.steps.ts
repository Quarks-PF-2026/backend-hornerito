import { defineFeature, loadFeature, DefineStepFunction } from 'jest-cucumber';
import { usarMundo } from './support/world';

const feature = loadFeature('./test/acceptance/QK-109.feature');

interface OrgResumen {
  id: string;
  name: string;
  locality: string | null;
}

interface Localidad {
  locality: string;
  province: string | null;
}

defineFeature(feature, (test) => {
  const mundo = usarMundo();

  /**
   * Crea una organización validada con nombre propio y, si se pide, la
   * localidad cargada como la carga el responsable en su perfil (QK-112).
   */
  const unaOrganizacionEn = async (alias: string, localidad: string | null) => {
    await mundo().unUsuarioAutenticado(alias);
    const nombre = `Comedor ${alias} ${Date.now()}`;
    const org = await mundo().unaOrganizacionValidada(alias, { name: nombre });
    if (localidad) {
      await mundo().dataSource.query(
        `UPDATE organizations SET locality = $1, province = 'Córdoba', country = 'Argentina' WHERE id = $2`,
        [localidad, org.id],
      );
    }
    mundo().datos.set(alias, org.id);
  };

  /** Directorio público, recortado a las organizaciones de este escenario. */
  const listar = async (query: Record<string, string>) => {
    const res = await mundo()
      .http()
      .get('/public/organizations')
      .query({ pageSize: 24, ...query })
      .expect(200);
    const propias = new Set(
      ['villa', 'rio', 'sin'].map((alias) => mundo().datos.get(alias)),
    );
    const body = res.body as { items: OrgResumen[] };
    return body.items.filter((org) => propias.has(org.id));
  };

  const antecedentes = (given: DefineStepFunction, and: DefineStepFunction) => {
    given(
      /^que existe una organización validada en "(.*)"$/,
      (localidad: string) => unaOrganizacionEn('villa', localidad),
    );
    and(
      /^que existe otra organización validada en "(.*)"$/,
      (localidad: string) => unaOrganizacionEn('rio', localidad),
    );
    and('que existe una organización validada sin localidad', () =>
      unaOrganizacionEn('sin', null),
    );
  };

  test('Filtrar por una localidad', ({ given, and, when, then }) => {
    antecedentes(given, and);
    let vistas: OrgResumen[] = [];

    when(
      /^el visitante filtra el inicio por "(.*)"$/,
      async (localidad: string) => {
        vistas = await listar({ locality: localidad });
      },
    );

    then(/^solo ve la organización de "(.*)"$/, (localidad: string) => {
      expect(vistas.map((org) => org.id)).toEqual([mundo().datos.get('villa')]);
      expect(vistas[0].locality).toBe(localidad);
    });
  });

  test('Sin filtro se ven todas', ({ given, and, when, then }) => {
    antecedentes(given, and);
    let vistas: OrgResumen[] = [];

    when('el visitante abre el inicio sin filtrar', async () => {
      vistas = await listar({});
    });

    then(
      've las tres organizaciones, también la que no tiene localidad',
      () => {
        expect(vistas).toHaveLength(3);
        expect(vistas.map((org) => org.id)).toContain(mundo().datos.get('sin'));
      },
    );
  });

  test('Solo se ofrecen localidades de organizaciones validadas', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);
    let localidades: string[] = [];

    given(
      /^que existe una organización pendiente en "(.*)"$/,
      async (localidad: string) => {
        await unaOrganizacionEn('pendiente', localidad);
        await mundo().dataSource.query(
          `UPDATE organizations SET status = 'pending' WHERE id = $1`,
          [mundo().datos.get('pendiente')],
        );
      },
    );

    when('el visitante pide las localidades para filtrar', async () => {
      const res = await mundo().http().get('/public/localities').expect(200);
      localidades = (res.body as Localidad[]).map((l) => l.locality);
    });

    then(/^se ofrecen "(.*)" y "(.*)"$/, (una: string, otra: string) => {
      expect(localidades).toEqual(expect.arrayContaining([una, otra]));
    });

    and(/^no se ofrece "(.*)"$/, (localidad: string) => {
      expect(localidades).not.toContain(localidad);
    });
  });

  test('El filtro se combina con la búsqueda', ({ given, and, when, then }) => {
    antecedentes(given, and);
    let vistas: OrgResumen[] = [];

    when(
      /^el visitante filtra el inicio por "(.*)" y busca "(.*)"$/,
      async (localidad: string, texto: string) => {
        // "Río" no está en el nombre ni la dirección de la de Villa María:
        // si el filtro se ignorara, aparecería la de Río Cuarto por su nombre.
        await mundo().dataSource.query(
          `UPDATE organizations SET name = 'Comedor Río Seco' WHERE id = $1`,
          [mundo().datos.get('rio')],
        );
        vistas = await listar({ locality: localidad, q: texto });
      },
    );

    then('no ve ninguna de las organizaciones', () => {
      expect(vistas).toEqual([]);
    });
  });
});
