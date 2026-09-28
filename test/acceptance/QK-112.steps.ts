import { defineFeature, loadFeature } from 'jest-cucumber';
import { usarMundo } from './support/world';

const feature = loadFeature('./test/acceptance/QK-112.feature');

/** Perfil base, el mismo que siembra `createOrganization`. */
const PERFIL = {
  name: 'Comedor Manos del Barrio',
  description: 'Brindamos almuerzo y merienda a más de 80 chicos.',
  address: 'Bv. Sarmiento 1450, Villa María, Córdoba',
  contact: '353 412-7788',
};

/**
 * Lo que devuelve el buscador de direcciones para cada localidad. El escenario
 * no consulta a Nominatim: pega contra un servicio externo haría que la
 * historia falle por una caída de red y no por el código. Que el buscador
 * arme bien estos tres datos se prueba aparte, en el unitario del geocoder.
 */
const SUGERENCIAS: Record<string, { province: string; country: string }> = {
  'Villa María': { province: 'Córdoba', country: 'Argentina' },
  'Río Cuarto': { province: 'Córdoba', country: 'Argentina' },
};

interface PerfilGuardado {
  name: string;
  description: string;
  address: string;
  contact: string;
  locality: string | null;
  province: string | null;
  country: string | null;
}

defineFeature(feature, (test) => {
  const mundo = usarMundo();

  /** Guarda el perfil, opcionalmente con la localidad elegida. */
  const guardarPerfil = (alias: string, localidad?: string) => {
    const ubicacion = localidad
      ? { locality: localidad, ...SUGERENCIAS[localidad] }
      : {};
    return mundo()
      .http()
      .put('/organization/me')
      .set('Authorization', mundo().auth(alias))
      .send({ ...PERFIL, ...ubicacion });
  };

  const leerPerfil = async (alias: string): Promise<PerfilGuardado> => {
    const res = await mundo()
      .http()
      .get('/organization/me')
      .set('Authorization', mundo().auth(alias))
      .expect(200);
    return (res.body as PerfilGuardado[])[0];
  };

  const unaOrganizacion = async (alias: string) => {
    await mundo().unUsuarioAutenticado(alias);
    await mundo().unaOrganizacionValidada(alias);
  };

  test('Elegir la localidad', ({ given, when, then, and }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    when(
      /^el responsable elige la localidad "(.*)" de las sugerencias y guarda su perfil$/,
      async (localidad: string) => {
        mundo().respuesta = await guardarPerfil('usuario', localidad);
      },
    );

    then(
      /^el perfil queda con la localidad "(.*)", la provincia "(.*)" y el país "(.*)"$/,
      async (localidad: string, provincia: string, pais: string) => {
        expect(mundo().ultimaRespuesta().status).toBe(200);
        const perfil = await leerPerfil('usuario');
        expect(perfil.locality).toBe(localidad);
        expect(perfil.province).toBe(provincia);
        expect(perfil.country).toBe(pais);
      },
    );

    and('el resto de los datos del perfil no cambió', async () => {
      const perfil = await leerPerfil('usuario');
      expect(perfil.address).toBe(PERFIL.address);
      expect(perfil.name).toBe(PERFIL.name);
      expect(perfil.description).toBe(PERFIL.description);
      expect(perfil.contact).toBe(PERFIL.contact);
    });
  });

  test('Guardar sin elegir localidad', ({ given, when, then, and }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    when(
      'el responsable guarda su perfil sin tocar el buscador de localidad',
      async () => {
        mundo().respuesta = await guardarPerfil('usuario');
      },
    );

    then('el perfil se guarda sin errores', () => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
    });

    and('el perfil queda sin localidad', async () => {
      const perfil = await leerPerfil('usuario');
      expect(perfil.locality).toBeNull();
      expect(perfil.province).toBeNull();
      expect(perfil.country).toBeNull();
    });
  });

  test('El buscador de direcciones no responde', ({
    given,
    when,
    then,
    and,
  }) => {
    const fetchOriginal = globalThis.fetch;

    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    given('que el buscador de direcciones no responde', () => {
      // Se corta la salida a internet, no el servicio propio: lo que la
      // historia pide es que una caída del proveedor externo no rompa nada.
      globalThis.fetch = jest
        .fn()
        .mockRejectedValue(new Error('Servicio no disponible'));
    });

    when('el responsable busca su localidad', async () => {
      mundo().respuesta = await mundo()
        .http()
        .get('/geocoding/search')
        .query({ q: 'Villa María' })
        .set('Authorization', mundo().auth('usuario'));
    });

    then('no aparece ninguna sugerencia y no se muestra un error', () => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      expect(mundo().ultimaRespuesta().body).toEqual([]);
    });

    and(
      'el responsable puede guardar el resto de su perfil igual',
      async () => {
        const respuesta = await guardarPerfil('usuario');
        globalThis.fetch = fetchOriginal;
        expect(respuesta.status).toBe(200);
        const perfil = await leerPerfil('usuario');
        expect(perfil.address).toBe(PERFIL.address);
        expect(perfil.locality).toBeNull();
      },
    );
  });

  test('Cambiar una localidad ya cargada', ({ given, when, then, and }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and(
      /^que el perfil ya tiene cargada la localidad "(.*)"$/,
      async (localidad: string) => {
        await guardarPerfil('usuario', localidad).expect(200);
      },
    );

    when(
      /^el responsable elige la localidad "(.*)" de las sugerencias y guarda su perfil$/,
      async (localidad: string) => {
        mundo().respuesta = await guardarPerfil('usuario', localidad);
      },
    );

    then(
      /^el perfil queda con la localidad "(.*)", la provincia "(.*)" y el país "(.*)"$/,
      async (localidad: string, provincia: string, pais: string) => {
        expect(mundo().ultimaRespuesta().status).toBe(200);
        const perfil = await leerPerfil('usuario');
        expect(perfil.locality).toBe(localidad);
        expect(perfil.province).toBe(provincia);
        expect(perfil.country).toBe(pais);
      },
    );
  });

  test('Cada organización con lo suyo', ({ given, when, then, and }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and('que existe otra organización con su propio responsable', async () => {
      await unaOrganizacion('otro');
    });

    and(
      /^que el perfil ya tiene cargada la localidad "(.*)"$/,
      async (localidad: string) => {
        await guardarPerfil('usuario', localidad).expect(200);
      },
    );

    when(
      /^el responsable de la otra organización elige la localidad "(.*)" de las sugerencias y guarda su perfil$/,
      async (localidad: string) => {
        mundo().respuesta = await guardarPerfil('otro', localidad);
      },
    );

    then('cada organización conserva su propia localidad', async () => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      expect((await leerPerfil('usuario')).locality).toBe('Villa María');
      expect((await leerPerfil('otro')).locality).toBe('Río Cuarto');
    });
  });
});
