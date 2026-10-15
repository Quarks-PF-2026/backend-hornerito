import { defineFeature, loadFeature } from 'jest-cucumber';
import { usarMundo } from './support/world';

const feature = loadFeature('./test/acceptance/QK-117.feature');

/** "Hoy" en el huso horario de la organización (América/Córdoba). */
function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
  }).format(new Date());
}

/** Suma (o resta, con `dias` negativo) días de calendario a una fecha 'YYYY-MM-DD'. */
function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}

/** Día de la semana de una fecha 'YYYY-MM-DD' (0 = domingo … 6 = sábado). */
function diaDeSemana(fecha: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const NUMERO_DE_DIA: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sábado: 6,
};

/** "lunes, miércoles y viernes" → [1, 3, 5]. */
function diasDeSemana(texto: string): number[] {
  return texto.split(/, | y /).map((nombre) => {
    // "sábados"/"domingos" → singular; "lunes"…"viernes" ya terminan en s.
    const dia = nombre.trim();
    return NUMERO_DE_DIA[dia] ?? NUMERO_DE_DIA[dia.replace(/s$/, '')];
  });
}

/** "Diario" = los siete días de la semana. */
const TODOS_LOS_DIAS = [0, 1, 2, 3, 4, 5, 6];

/** Hora de comienzo por defecto: informativa, no condiciona nada en estos escenarios. */
const HORA_POR_DEFECTO = '17:00';

interface CrearEventoBody {
  name: string;
  kind: 'periodic' | 'one_off';
  startDate: string;
  startTime: string;
  weekdays?: number[];
}

/** Body de un evento periódico diario con la hora por defecto. */
function diario(name: string, startDate: string): CrearEventoBody {
  return {
    name,
    kind: 'periodic',
    startDate,
    startTime: HORA_POR_DEFECTO,
    weekdays: TODOS_LOS_DIAS,
  };
}

interface EventoBody {
  id: string;
  name: string;
  kind: 'periodic' | 'one_off';
  startDate: string;
  startTime: string;
  weekdays: number[] | null;
  active: boolean;
  endedOn: string | null;
}

interface Ocurrencia {
  date: string;
  count: number | null;
}

defineFeature(feature, (test) => {
  const mundo = usarMundo();

  const crearEvento = (alias: string, body: CrearEventoBody) =>
    mundo()
      .http()
      .post('/events')
      .set('Authorization', mundo().auth(alias))
      .send(body);

  const editarEvento = (
    alias: string,
    id: string,
    body: Record<string, unknown>,
  ) =>
    mundo()
      .http()
      .put(`/events/${id}`)
      .set('Authorization', mundo().auth(alias))
      .send(body);

  const darDeBaja = (alias: string, id: string) =>
    mundo()
      .http()
      .patch(`/events/${id}/deactivate`)
      .set('Authorization', mundo().auth(alias));

  const listarOcurrencias = (
    alias: string,
    id: string,
    from: string,
    to: string,
  ) =>
    mundo()
      .http()
      .get(`/events/${id}/occurrences`)
      .query({ from, to })
      .set('Authorization', mundo().auth(alias));

  const cargarAsistencia = (
    alias: string,
    id: string,
    date: string,
    count: number,
  ) =>
    mundo()
      .http()
      .put(`/events/${id}/attendance/${date}`)
      .set('Authorization', mundo().auth(alias))
      .send({ count });

  const listarEventos = (alias: string) =>
    mundo().http().get('/events').set('Authorization', mundo().auth(alias));

  const guardarEvento = (nombre: string, body: EventoBody) =>
    mundo().datos.set(`evento:${nombre}`, body);

  const eventoGuardado = (nombre: string): EventoBody =>
    mundo().datos.get(`evento:${nombre}`) as EventoBody;

  const unaOrganizacion = async (alias: string) => {
    await mundo().unUsuarioAutenticado(alias);
    await mundo().unaOrganizacionValidada(alias);
  };

  /** Precondición reusada por varios escenarios: un evento periódico que ya empezó hoy. */
  const existeElEvento = async (nombre: string) => {
    const res = await crearEvento('usuario', diario(nombre, hoy()));
    guardarEvento(nombre, res.body as EventoBody);
  };

  test('Crear un evento periódico', ({ given, when, then, and }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    when(
      /^el responsable crea el evento periódico "(.*)" que empezó hace (\d+) días$/,
      async (nombre: string, dias: string) => {
        const startDate = sumarDias(hoy(), -Number(dias));
        mundo().respuesta = await crearEvento(
          'usuario',
          diario(nombre, startDate),
        );
      },
    );

    then(/^el evento "(.*)" queda creado$/, (nombre: string) => {
      expect(mundo().ultimaRespuesta().status).toBe(201);
      const body = mundo().ultimaRespuesta().body as EventoBody;
      expect(body.name).toBe(nombre);
      expect(body.kind).toBe('periodic');
      guardarEvento(nombre, body);
    });

    and(
      'hay una ocurrencia disponible por cada día desde que empezó hasta hoy',
      async () => {
        const evento = eventoGuardado('Merienda diaria');
        const res = await listarOcurrencias(
          'usuario',
          evento.id,
          evento.startDate,
          hoy(),
        );
        expect(res.status).toBe(200);
        const ocurrencias = res.body as Ocurrencia[];
        const fechaEsperada: string[] = [];
        for (let f = evento.startDate; f <= hoy(); f = sumarDias(f, 1)) {
          fechaEsperada.push(f);
        }
        expect(ocurrencias.map((o) => o.date)).toEqual(fechaEsperada);
        expect(ocurrencias.every((o) => o.count === null)).toBe(true);
      },
    );
  });

  test('Crear un evento periódico en algunos días de la semana', ({
    given,
    when,
    then,
    and,
  }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    when(
      /^el responsable crea el evento periódico "(.*)" los (.*) que empezó hace (\d+) días$/,
      async (nombre: string, dias: string, haceDias: string) => {
        const weekdays = diasDeSemana(dias);
        mundo().datos.set('weekdays', weekdays);
        mundo().respuesta = await crearEvento('usuario', {
          name: nombre,
          kind: 'periodic',
          startDate: sumarDias(hoy(), -Number(haceDias)),
          startTime: HORA_POR_DEFECTO,
          weekdays,
        });
      },
    );

    then(/^el evento "(.*)" queda creado$/, (nombre: string) => {
      expect(mundo().ultimaRespuesta().status).toBe(201);
      const body = mundo().ultimaRespuesta().body as EventoBody;
      expect(body.name).toBe(nombre);
      expect(body.kind).toBe('periodic');
      expect(body.weekdays).toEqual(mundo().datos.get('weekdays'));
      guardarEvento(nombre, body);
    });

    and(
      /^hay una ocurrencia disponible solo en los (.*) desde que empezó hasta hoy$/,
      async (dias: string) => {
        const weekdays = diasDeSemana(dias);
        const evento = eventoGuardado('Apoyo escolar');
        const res = await listarOcurrencias(
          'usuario',
          evento.id,
          evento.startDate,
          hoy(),
        );
        expect(res.status).toBe(200);
        // Se calcula filtrando el calendario real: 14 días siempre cubren dos
        // semanas, así que el resultado no depende de qué día cae hoy.
        const fechasEsperadas: string[] = [];
        for (let f = evento.startDate; f <= hoy(); f = sumarDias(f, 1)) {
          if (weekdays.includes(diaDeSemana(f))) fechasEsperadas.push(f);
        }
        const ocurrencias = res.body as Ocurrencia[];
        expect(ocurrencias.map((o) => o.date)).toEqual(fechasEsperadas);
      },
    );
  });

  test('La hora de comienzo de un evento queda guardada', ({
    given,
    when,
    then,
    and,
  }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    when(
      /^el responsable crea el evento periódico "(.*)" que comienza a las (\d{2}:\d{2})$/,
      async (nombre: string, hora: string) => {
        mundo().respuesta = await crearEvento('usuario', {
          ...diario(nombre, hoy()),
          startTime: hora,
        });
      },
    );

    then(
      /^el evento "(.*)" queda creado con hora de comienzo (\d{2}:\d{2})$/,
      (nombre: string, hora: string) => {
        expect(mundo().ultimaRespuesta().status).toBe(201);
        const body = mundo().ultimaRespuesta().body as EventoBody;
        expect(body.name).toBe(nombre);
        expect(body.startTime).toBe(hora);
      },
    );

    and(
      /^en el listado de eventos figura con hora de comienzo (\d{2}:\d{2})$/,
      async (hora: string) => {
        const res = await listarEventos('usuario');
        expect(res.status).toBe(200);
        const eventos = res.body as EventoBody[];
        expect(eventos.map((e) => e.startTime)).toEqual([hora]);
      },
    );
  });

  test('Crear un evento extraordinario', ({ given, when, then, and }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    when(
      /^el responsable crea el evento extraordinario "(.*)" para hoy$/,
      async (nombre: string) => {
        mundo().respuesta = await crearEvento('usuario', {
          name: nombre,
          kind: 'one_off',
          startDate: hoy(),
          startTime: HORA_POR_DEFECTO,
        });
      },
    );

    then(/^el evento "(.*)" queda creado$/, (nombre: string) => {
      expect(mundo().ultimaRespuesta().status).toBe(201);
      const body = mundo().ultimaRespuesta().body as EventoBody;
      expect(body.name).toBe(nombre);
      expect(body.kind).toBe('one_off');
      guardarEvento(nombre, body);
    });

    and(
      'hay una única ocurrencia disponible, en esa fecha puntual',
      async () => {
        const evento = eventoGuardado('Colecta de invierno');
        const res = await listarOcurrencias(
          'usuario',
          evento.id,
          evento.startDate,
          evento.startDate,
        );
        expect(res.status).toBe(200);
        const ocurrencias = res.body as Ocurrencia[];
        expect(ocurrencias).toEqual([{ date: evento.startDate, count: null }]);
      },
    );
  });

  test('Editar el nombre de un evento sin asistencia registrada', ({
    given,
    and,
    when,
    then,
  }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and(/^que existe el evento "(.*)"$/, async (nombre: string) => {
      await existeElEvento(nombre);
    });

    when(
      /^el responsable le cambia el nombre a "(.*)"$/,
      async (nuevoNombre: string) => {
        mundo().datos.set('nombreEsperado', nuevoNombre);
        const evento = eventoGuardado('Merienda diaria');
        mundo().respuesta = await editarEvento('usuario', evento.id, {
          name: nuevoNombre,
        });
      },
    );

    then('el cambio se guarda sin restricciones', () => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      const body = mundo().ultimaRespuesta().body as EventoBody;
      expect(body.name).toBe(mundo().datos.get('nombreEsperado'));
    });
  });

  test('Dar de baja un evento periódico conserva su historial', ({
    given,
    and,
    when,
    then,
  }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and(
      /^que existe el evento periódico "(.*)" que empezó hace (\d+) días$/,
      async (nombre: string, dias: string) => {
        const res = await crearEvento(
          'usuario',
          diario(nombre, sumarDias(hoy(), -Number(dias))),
        );
        guardarEvento(nombre, res.body as EventoBody);
      },
    );

    and(
      /^que se cargó la asistencia de hace (\d+) días$/,
      async (dias: string) => {
        const evento = eventoGuardado('Merienda diaria');
        await cargarAsistencia(
          'usuario',
          evento.id,
          sumarDias(hoy(), -Number(dias)),
          7,
        ).expect(200);
      },
    );

    when('el responsable da de baja el evento', async () => {
      const evento = eventoGuardado('Merienda diaria');
      mundo().respuesta = await darDeBaja('usuario', evento.id);
    });

    then('el evento deja de estar activo desde hoy', () => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      const body = mundo().ultimaRespuesta().body as EventoBody;
      expect(body.active).toBe(false);
      expect(body.endedOn).toBe(hoy());
      guardarEvento('Merienda diaria', body);
    });

    and(
      'las ocurrencias y la asistencia ya registradas siguen disponibles',
      async () => {
        const evento = eventoGuardado('Merienda diaria');
        const res = await listarOcurrencias(
          'usuario',
          evento.id,
          evento.startDate,
          hoy(),
        );
        expect(res.status).toBe(200);
        const ocurrencias = res.body as Ocurrencia[];
        const conAsistencia = ocurrencias.find(
          (o) => o.date === sumarDias(hoy(), -2),
        );
        expect(conAsistencia?.count).toBe(7);
        expect(ocurrencias.every((o) => o.date <= hoy())).toBe(true);
      },
    );

    and('ya no se puede cargar la asistencia de mañana', async () => {
      const evento = eventoGuardado('Merienda diaria');
      const res = await cargarAsistencia(
        'usuario',
        evento.id,
        sumarDias(hoy(), 1),
        1,
      );
      expect(res.status).toBe(400);
    });
  });

  test('Cada organización ve únicamente sus propios eventos', ({
    given,
    and,
    when,
    then,
  }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and(/^que existe el evento "(.*)"$/, async (nombre: string) => {
      await existeElEvento(nombre);
    });

    and(
      /^que existe otra organización con su propio responsable y su propio evento "(.*)"$/,
      async (nombre: string) => {
        await mundo().unUsuarioAutenticado('otra');
        await mundo().unaOrganizacionValidada('otra', {
          name: `Comedor otra org ${Date.now()}`,
        });
        const res = await crearEvento('otra', diario(nombre, hoy()));
        guardarEvento(nombre, res.body as EventoBody);
      },
    );

    when('el responsable pide el listado de sus eventos', async () => {
      mundo().respuesta = await listarEventos('usuario');
    });

    then(/^solo ve "(.*)" en su listado$/, (nombre: string) => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      const eventos = mundo().ultimaRespuesta().body as EventoBody[];
      expect(eventos.map((e) => e.name)).toEqual([nombre]);
    });
  });

  test('Un voluntario no puede crear eventos', ({ given, when, then }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    given('que hay un voluntario en la organización', async () => {
      const organizationId = mundo().datos.get('organizationId') as string;
      await mundo().unMiembroConRol('voluntario', 'voluntario', organizationId);
    });

    when(
      /^el voluntario intenta crear el evento "(.*)"$/,
      async (nombre: string) => {
        mundo().respuesta = await crearEvento(
          'voluntario',
          diario(nombre, hoy()),
        );
      },
    );

    then('el sistema no se lo permite', () => {
      expect(mundo().ultimaRespuesta().status).toBe(403);
    });
  });

  test('Un voluntario no puede editar ni dar de baja un evento', ({
    given,
    and,
    when,
    then,
  }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and(/^que existe el evento "(.*)"$/, async (nombre: string) => {
      await existeElEvento(nombre);
    });

    and('que hay un voluntario en la organización', async () => {
      const organizationId = mundo().datos.get('organizationId') as string;
      await mundo().unMiembroConRol('voluntario', 'voluntario', organizationId);
    });

    when(
      /^el voluntario intenta cambiarle el nombre al evento "(.*)"$/,
      async (nombre: string) => {
        const evento = eventoGuardado(nombre);
        mundo().respuesta = await editarEvento('voluntario', evento.id, {
          name: 'Nombre que no debería guardarse',
        });
      },
    );

    then('el sistema no se lo permite', () => {
      expect(mundo().ultimaRespuesta().status).toBe(403);
    });

    when(
      /^el voluntario intenta dar de baja el evento "(.*)"$/,
      async (nombre: string) => {
        const evento = eventoGuardado(nombre);
        mundo().respuesta = await darDeBaja('voluntario', evento.id);
      },
    );

    then('el sistema no se lo permite', () => {
      expect(mundo().ultimaRespuesta().status).toBe(403);
    });
  });

  test('Un evento con asistencia registrada no permite cambiar el tipo ni la fecha de inicio, pero sí el nombre', ({
    given,
    and,
    when,
    then,
  }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and(/^que existe el evento "(.*)"$/, async (nombre: string) => {
      await existeElEvento(nombre);
    });

    and('que se cargó la asistencia de hoy', async () => {
      const evento = eventoGuardado('Merienda diaria');
      await cargarAsistencia('usuario', evento.id, hoy(), 5).expect(200);
    });

    when(
      'el responsable intenta cambiarle el tipo a extraordinario',
      async () => {
        const evento = eventoGuardado('Merienda diaria');
        mundo().respuesta = await editarEvento('usuario', evento.id, {
          kind: 'one_off',
        });
      },
    );

    then('el sistema no se lo permite', () => {
      expect(mundo().ultimaRespuesta().status).toBe(409);
    });

    when('el responsable intenta cambiarle la fecha de inicio', async () => {
      const evento = eventoGuardado('Merienda diaria');
      mundo().respuesta = await editarEvento('usuario', evento.id, {
        startDate: sumarDias(evento.startDate, -1),
      });
    });

    then('el sistema no se lo permite', () => {
      expect(mundo().ultimaRespuesta().status).toBe(409);
    });

    when('el responsable le cambia el nombre', async () => {
      mundo().datos.set('nombreEsperado', 'Merienda de la tarde renovada');
      const evento = eventoGuardado('Merienda diaria');
      mundo().respuesta = await editarEvento('usuario', evento.id, {
        name: 'Merienda de la tarde renovada',
      });
    });

    then('el cambio se guarda sin restricciones', () => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      const body = mundo().ultimaRespuesta().body as EventoBody;
      expect(body.name).toBe(mundo().datos.get('nombreEsperado'));
    });
  });

  test('Con asistencia registrada se puede cambiar la hora de comienzo', ({
    given,
    and,
    when,
    then,
  }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and(/^que existe el evento "(.*)"$/, async (nombre: string) => {
      await existeElEvento(nombre);
    });

    and('que se cargó la asistencia de hoy', async () => {
      const evento = eventoGuardado('Merienda diaria');
      await cargarAsistencia('usuario', evento.id, hoy(), 5).expect(200);
    });

    when(
      /^el responsable le cambia la hora de comienzo a las (\d{2}:\d{2})$/,
      async (hora: string) => {
        mundo().datos.set('horaEsperada', hora);
        const evento = eventoGuardado('Merienda diaria');
        mundo().respuesta = await editarEvento('usuario', evento.id, {
          startTime: hora,
        });
      },
    );

    then('la nueva hora de comienzo queda guardada', () => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      const body = mundo().ultimaRespuesta().body as EventoBody;
      expect(body.startTime).toBe(mundo().datos.get('horaEsperada'));
    });
  });

  test('Con asistencia registrada no se pueden cambiar los días de la semana', ({
    given,
    and,
    when,
    then,
  }) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and(/^que existe el evento "(.*)"$/, async (nombre: string) => {
      await existeElEvento(nombre);
    });

    and('que se cargó la asistencia de hoy', async () => {
      const evento = eventoGuardado('Merienda diaria');
      await cargarAsistencia('usuario', evento.id, hoy(), 5).expect(200);
    });

    when(
      /^el responsable intenta cambiarle los días de la semana a (.*)$/,
      async (dias: string) => {
        const evento = eventoGuardado('Merienda diaria');
        mundo().respuesta = await editarEvento('usuario', evento.id, {
          weekdays: diasDeSemana(dias),
        });
      },
    );

    then('el sistema no se lo permite', () => {
      expect(mundo().ultimaRespuesta().status).toBe(409);
    });
  });
});
