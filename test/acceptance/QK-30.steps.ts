import { defineFeature, loadFeature } from 'jest-cucumber';
import { usarMundo } from './support/world';

const feature = loadFeature('./test/acceptance/QK-30.feature');

/** "Hoy" en el huso horario de la organización (América/Córdoba). */
function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
  }).format(new Date());
}

function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}

interface Proyeccion {
  eventId: string;
  eventName: string;
  daysRecorded: number;
  minDaysRequired: number;
  sufficientHistory: boolean;
  trend: 'sube' | 'baja' | 'estable' | null;
  forecast: { date: string; expected: number }[];
}

defineFeature(feature, (test) => {
  const mundo = usarMundo();

  const unaOrganizacion = async (alias: string) => {
    await mundo().unUsuarioAutenticado(alias);
    await mundo().unaOrganizacionValidada(alias);
  };

  /**
   * Crea un evento periódico que empezó hace `dias - 1` días y carga una
   * asistencia por día hasta hoy: `inicial + paso * i`. Serie exacta, sin
   * ruido, para que la regresión dé pendiente y valores deterministas.
   */
  const eventoConAsistencia = async (
    alias: string,
    nombre: string,
    dias: number,
    inicial: number,
    paso: number,
  ) => {
    const http = () => mundo().http();
    const auth = mundo().auth(alias);
    const creado = await http()
      .post('/events')
      .set('Authorization', auth)
      .send({
        name: nombre,
        kind: 'periodic',
        startDate: sumarDias(hoy(), -(dias - 1)),
      })
      .expect(201);
    const id = (creado.body as { id: string }).id;
    for (let i = 0; i < dias; i++) {
      await http()
        .put(`/events/${id}/attendance/${sumarDias(hoy(), -(dias - 1) + i)}`)
        .set('Authorization', auth)
        .send({ count: inicial + paso * i })
        .expect(200);
    }
  };

  const consultarProyeccion = (alias: string) =>
    mundo()
      .http()
      .get('/events/attendance-forecast')
      .set('Authorization', mundo().auth(alias));

  const proyecciones = (): Proyeccion[] => {
    const res = mundo().ultimaRespuesta();
    expect(res.status).toBe(200);
    return res.body as Proyeccion[];
  };

  const proyeccionDe = (nombre: string): Proyeccion => {
    const p = proyecciones().find((e) => e.eventName === nombre);
    expect(p).toBeDefined();
    return p as Proyeccion;
  };

  /** Steps compartidos por los escenarios que consultan la proyección. */
  const dadoResponsable = (given: (re: string, fn: () => unknown) => void) =>
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

  const CRECIENTE =
    /^que existe el evento periódico "(.*)" con asistencia desde (\d+) personas que crece (\d+) por día durante (\d+) días$/;
  const CONSTANTE =
    /^que existe el evento periódico "(.*)" con asistencia constante de (\d+) personas durante (\d+) días$/;

  const cuandoConsulta = (when: (re: string, fn: () => unknown) => void) =>
    when('el responsable consulta la asistencia proyectada', async () => {
      mundo().respuesta = await consultarProyeccion('usuario');
    });

  test('Proyección con historial suficiente y asistencia creciente', ({
    given,
    and,
    when,
    then,
  }) => {
    dadoResponsable(given);

    and(CRECIENTE, async (n: string, ini: string, paso: string, d: string) => {
      await eventoConAsistencia(
        'usuario',
        n,
        Number(d),
        Number(ini),
        Number(paso),
      );
    });

    cuandoConsulta(when);

    then(
      /^ve el evento "(.*)" con (\d+) días de asistencia registrada$/,
      (nombre: string, dias: string) => {
        const p = proyeccionDe(nombre);
        expect(p.daysRecorded).toBe(Number(dias));
        expect(p.minDaysRequired).toBe(30);
        expect(p.sufficientHistory).toBe(true);
      },
    );

    and(/^la tendencia es "(.*)"$/, (tendencia: string) => {
      expect(proyeccionDe('Almuerzo diario').trend).toBe(tendencia);
    });

    and(
      've la cantidad estimada de personas para cada uno de los próximos 7 días',
      () => {
        const { forecast } = proyeccionDe('Almuerzo diario');
        expect(forecast.map((f) => f.date)).toEqual(
          Array.from({ length: 7 }, (_, i) => sumarDias(hoy(), i + 1)),
        );
      },
    );

    and(
      /^la estimación para mañana es de (\d+) personas y crece (\d+) por día$/,
      (manana: string, paso: string) => {
        const { forecast } = proyeccionDe('Almuerzo diario');
        expect(forecast.map((f) => f.expected)).toEqual(
          Array.from(
            { length: 7 },
            (_, i) => Number(manana) + Number(paso) * i,
          ),
        );
      },
    );
  });

  test('Proyección con asistencia estable', ({ given, and, when, then }) => {
    dadoResponsable(given);

    and(CONSTANTE, async (n: string, cant: string, d: string) => {
      await eventoConAsistencia('usuario', n, Number(d), Number(cant), 0);
    });

    cuandoConsulta(when);

    then(/^la tendencia es "(.*)"$/, (tendencia: string) => {
      expect(proyeccionDe('Almuerzo diario').trend).toBe(tendencia);
    });

    and(
      've la cantidad estimada de personas para cada uno de los próximos 7 días',
      () => {
        const { forecast } = proyeccionDe('Almuerzo diario');
        expect(forecast.map((f) => f.date)).toEqual(
          Array.from({ length: 7 }, (_, i) => sumarDias(hoy(), i + 1)),
        );
      },
    );

    and(
      /^la estimación para mañana es de (\d+) personas y crece (\d+) por día$/,
      (manana: string, paso: string) => {
        const { forecast } = proyeccionDe('Almuerzo diario');
        expect(forecast.map((f) => f.expected)).toEqual(
          Array.from(
            { length: 7 },
            (_, i) => Number(manana) + Number(paso) * i,
          ),
        );
      },
    );
  });

  test('Historial insuficiente', ({ given, and, when, then }) => {
    dadoResponsable(given);

    and(CONSTANTE, async (n: string, cant: string, d: string) => {
      await eventoConAsistencia('usuario', n, Number(d), Number(cant), 0);
    });

    cuandoConsulta(when);

    then(
      /^no se muestra proyección para el evento "(.*)"$/,
      (nombre: string) => {
        const p = proyeccionDe(nombre);
        expect(p.sufficientHistory).toBe(false);
        expect(p.trend).toBeNull();
        expect(p.forecast).toEqual([]);
      },
    );

    and(
      /^se informa que faltan registros para llegar a (\d+) días$/,
      (minimo: string) => {
        const p = proyeccionDe('Almuerzo diario');
        expect(p.daysRecorded).toBe(10);
        expect(p.minDaysRequired).toBe(Number(minimo));
      },
    );
  });

  test('Los eventos extraordinarios no tienen proyección', ({
    given,
    and,
    when,
    then,
  }) => {
    dadoResponsable(given);

    and(/^que existe el evento extraordinario "(.*)"$/, async (n: string) => {
      await mundo()
        .http()
        .post('/events')
        .set('Authorization', mundo().auth('usuario'))
        .send({ name: n, kind: 'one_off', startDate: hoy() })
        .expect(201);
    });

    cuandoConsulta(when);

    then('no aparece ningún evento en la proyección', () => {
      expect(proyecciones()).toEqual([]);
    });
  });

  test('Una organización no ve la proyección de otra', ({
    given,
    and,
    when,
    then,
  }) => {
    dadoResponsable(given);

    and(CRECIENTE, async (n: string, ini: string, paso: string, d: string) => {
      await eventoConAsistencia(
        'usuario',
        n,
        Number(d),
        Number(ini),
        Number(paso),
      );
    });

    and(
      /^que existe otra organización con su propio responsable y su propio evento periódico "(.*)" con asistencia constante de (\d+) personas durante (\d+) días$/,
      async (n: string, cant: string, d: string) => {
        await mundo().unUsuarioAutenticado('otra');
        await mundo().unaOrganizacionValidada('otra', {
          name: `Comedor otra org ${Date.now()}`,
        });
        await eventoConAsistencia('otra', n, Number(d), Number(cant), 0);
      },
    );

    cuandoConsulta(when);

    then(/^solo ve el evento "(.*)" en la proyección$/, (nombre: string) => {
      expect(proyecciones().map((p) => p.eventName)).toEqual([nombre]);
    });
  });

  // --- Sugerencias de insumos (CA-1 a CA-5) --------------------------------

  interface Sugerencia {
    supplyId: string;
    supplyName: string;
    category: string;
    timesRequested: number;
    lastRequestedAt: string;
  }

  const crearInsumo = async (alias: string, nombre: string) => {
    const res = await mundo()
      .http()
      .post('/supplies')
      .set('Authorization', mundo().auth(alias))
      .send({ name: nombre, category: 'Alimentos secos', unit: 'Kilogramos' })
      .expect(201);
    const id = (res.body as { id: string }).id;
    mundo().datos.set(`insumo:${alias}:${nombre}`, id);
    return id;
  };

  const crearNecesidad = async (
    alias: string,
    supplyId: string,
    haceDias: number,
    cerrada: boolean,
  ) => {
    const res = await mundo()
      .http()
      .post('/needs')
      .set('Authorization', mundo().auth(alias))
      .send({
        supplyId,
        requiredQuantity: 10,
        deadline: sumarDias(hoy(), 30),
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    if (haceDias > 0) {
      // La fecha de creación no es editable por la API: se retrocede en la base.
      await mundo().dataSource.query(
        `UPDATE needs SET "createdAt" = now() - make_interval(days => $2) WHERE id = $1`,
        [id, haceDias],
      );
    }
    if (cerrada) {
      await mundo()
        .http()
        .patch(`/needs/${id}/close`)
        .set('Authorization', mundo().auth(alias))
        .expect(200);
    }
  };

  /** `n` necesidades cerradas, espaciadas 5 días hacia atrás desde `ultimaHace`. */
  const insumoConHistorial = async (
    alias: string,
    nombre: string,
    n: number,
    ultimaHace: number,
  ) => {
    const id = await crearInsumo(alias, nombre);
    for (let i = 0; i < n; i++) {
      await crearNecesidad(alias, id, ultimaHace + 5 * i, true);
    }
  };

  const consultarSugerencias = (alias: string) =>
    mundo()
      .http()
      .get('/needs/suggestions')
      .set('Authorization', mundo().auth(alias));

  const sugerencias = (): Sugerencia[] => {
    const res = mundo().ultimaRespuesta();
    expect(res.status).toBe(200);
    return res.body as Sugerencia[];
  };

  const CON_HISTORIAL =
    /^que existe el insumo "(.*)" con (\d+) necesidad(?:es)? cerrad(?:a|as), la última hace (\d+) días$/;
  const CONSULTA_SUGERENCIAS =
    'el responsable consulta las sugerencias de nuevas necesidades';
  const historialPropio = async (n: string, c: string, d: string) =>
    insumoConHistorial('usuario', n, Number(c), Number(d));
  const consultaPropia = async () => {
    mundo().respuesta = await consultarSugerencias('usuario');
  };
  const soloSeSugiere = (n: string) => {
    expect(sugerencias().map((s) => s.supplyName)).toEqual([n]);
  };

  test('Se sugieren hasta 3 insumos, los más pedidos primero', ({
    given,
    and,
    when,
    then,
  }) => {
    dadoResponsable(given);
    and(CON_HISTORIAL, historialPropio);
    and(CON_HISTORIAL, historialPropio);
    and(CON_HISTORIAL, historialPropio);
    and(CON_HISTORIAL, historialPropio);
    and(CON_HISTORIAL, historialPropio);
    when(CONSULTA_SUGERENCIAS, consultaPropia);

    then(/^se sugieren los insumos "(.*)" en ese orden$/, (nombres: string) => {
      expect(sugerencias().map((s) => s.supplyName)).toEqual(
        nombres.split(', '),
      );
    });

    and(/^"(.*)" figura como pedido (\d+) veces$/, (n: string, v: string) => {
      const s = sugerencias().find((x) => x.supplyName === n);
      expect(s?.timesRequested).toBe(Number(v));
      expect(s?.lastRequestedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    and(
      'cada sugerencia trae el insumo para prellenar la nueva necesidad',
      () => {
        for (const s of sugerencias()) {
          expect(s.supplyId).toBe(
            mundo().datos.get(`insumo:usuario:${s.supplyName}`),
          );
        }
      },
    );
  });

  test('Sin historial de necesidades no hay sugerencias', ({
    given,
    and,
    when,
    then,
  }) => {
    dadoResponsable(given);
    and(
      /^que existe el insumo "(.*)" sin ninguna necesidad$/,
      async (n: string) => {
        await crearInsumo('usuario', n);
      },
    );
    when(CONSULTA_SUGERENCIAS, consultaPropia);
    then('no se sugiere ningún insumo', () => {
      expect(sugerencias()).toEqual([]);
    });
  });

  test('Un insumo con una necesidad abierta no se sugiere', ({
    given,
    and,
    when,
    then,
  }) => {
    dadoResponsable(given);
    and(CON_HISTORIAL, historialPropio);
    and(CON_HISTORIAL, historialPropio);
    and(
      /^que el insumo "(.*)" tiene además una necesidad abierta$/,
      async (n: string) => {
        const id = mundo().datos.get(`insumo:usuario:${n}`) as string;
        await crearNecesidad('usuario', id, 0, false);
      },
    );
    when(CONSULTA_SUGERENCIAS, consultaPropia);
    then(/^solo se sugiere el insumo "(.*)"$/, soloSeSugiere);
  });

  test('Las necesidades de hace más de 90 días no cuentan', ({
    given,
    and,
    when,
    then,
  }) => {
    dadoResponsable(given);
    and(CON_HISTORIAL, historialPropio);
    and(CON_HISTORIAL, historialPropio);
    when(CONSULTA_SUGERENCIAS, consultaPropia);
    then(/^solo se sugiere el insumo "(.*)"$/, soloSeSugiere);
  });

  test('Una organización no recibe sugerencias basadas en datos de otra', ({
    given,
    and,
    when,
    then,
  }) => {
    dadoResponsable(given);
    and(CON_HISTORIAL, historialPropio);
    and(
      /^que existe otra organización con su propio responsable y su propio insumo "(.*)" con (\d+) necesidad(?:es)? cerrad(?:a|as), la última hace (\d+) días$/,
      async (n: string, c: string, d: string) => {
        await mundo().unUsuarioAutenticado('otra');
        await mundo().unaOrganizacionValidada('otra', {
          name: `Comedor otra org ${Date.now()}`,
        });
        await insumoConHistorial('otra', n, Number(c), Number(d));
      },
    );
    when(CONSULTA_SUGERENCIAS, consultaPropia);
    then(/^solo se sugiere el insumo "(.*)"$/, soloSeSugiere);
  });
});
