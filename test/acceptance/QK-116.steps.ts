import { defineFeature, loadFeature, DefineStepFunction } from 'jest-cucumber';
import { usarMundo } from './support/world';

const feature = loadFeature('./test/acceptance/QK-116.feature');

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

interface EventoBody {
  id: string;
  name: string;
  kind: 'periodic' | 'one_off';
  startDate: string;
}

interface Ocurrencia {
  date: string;
  count: number | null;
}

defineFeature(feature, (test) => {
  const mundo = usarMundo();

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

  const evento = (): EventoBody => mundo().datos.get('evento') as EventoBody;

  const unaOrganizacion = async (alias: string) => {
    await mundo().unUsuarioAutenticado(alias);
    await mundo().unaOrganizacionValidada(alias);
  };

  const antecedentes = (given: DefineStepFunction, and: DefineStepFunction) => {
    given('que existe una organización con su responsable', async () => {
      await unaOrganizacion('usuario');
    });

    and(/^que existe el evento "(.*)"$/, async (nombre: string) => {
      const res = await mundo()
        .http()
        .post('/events')
        .set('Authorization', mundo().auth('usuario'))
        .send({
          name: nombre,
          kind: 'periodic',
          startDate: hoy(),
          startTime: '17:00',
          weekdays: [0, 1, 2, 3, 4, 5, 6],
        });
      mundo().datos.set('evento', res.body as EventoBody);
    });
  };

  test('Registrar el conteo de una ocurrencia', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    when(
      /^el responsable registra que hoy asistieron (\d+) beneficiarios$/,
      async (cantidad: string) => {
        mundo().respuesta = await cargarAsistencia(
          'usuario',
          evento().id,
          hoy(),
          Number(cantidad),
        );
      },
    );

    then(/^el conteo de hoy queda guardado en (\d+)$/, (cantidad: string) => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      const body = mundo().ultimaRespuesta().body as { count: number };
      expect(body.count).toBe(Number(cantidad));
    });

    and('aparece en el historial interno de la organización', async () => {
      const res = await listarOcurrencias('usuario', evento().id, hoy(), hoy());
      expect(res.status).toBe(200);
      const ocurrencias = res.body as Ocurrencia[];
      expect(ocurrencias).toEqual([{ date: hoy(), count: 42 }]);
    });
  });

  test('Corregir un conteo ya cargado', ({ given, and, when, then }) => {
    antecedentes(given, and);

    and(
      /^que ya se registró que hoy asistieron (\d+) beneficiarios$/,
      async (cantidad: string) => {
        await cargarAsistencia(
          'usuario',
          evento().id,
          hoy(),
          Number(cantidad),
        ).expect(200);
      },
    );

    when(
      /^el responsable corrige el conteo de hoy a (\d+) beneficiarios$/,
      async (cantidad: string) => {
        mundo().respuesta = await cargarAsistencia(
          'usuario',
          evento().id,
          hoy(),
          Number(cantidad),
        );
      },
    );

    then(
      /^el conteo de hoy queda guardado en (\d+)$/,
      async (cantidad: string) => {
        expect(mundo().ultimaRespuesta().status).toBe(200);
        const res = await listarOcurrencias(
          'usuario',
          evento().id,
          hoy(),
          hoy(),
        );
        const ocurrencias = res.body as Ocurrencia[];
        expect(ocurrencias[0].count).toBe(Number(cantidad));
      },
    );
  });

  test('El conteo no es un dato público', ({ given, and, when, then }) => {
    antecedentes(given, and);

    and(
      /^que ya se registró que hoy asistieron (\d+) beneficiarios$/,
      async (cantidad: string) => {
        await cargarAsistencia(
          'usuario',
          evento().id,
          hoy(),
          Number(cantidad),
        ).expect(200);
      },
    );

    when(
      'un visitante sin cuenta entra a la ficha pública de la organización',
      async () => {
        const organizationId = mundo().datos.get('organizationId') as string;
        mundo().respuesta = await mundo()
          .http()
          .get(`/public/organizations/${organizationId}`);
      },
    );

    then('no ve ningún dato de asistencia', () => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      const crudo = JSON.stringify(mundo().ultimaRespuesta().body);
      expect(crudo).not.toContain('attendance');
      expect(crudo).not.toContain('attendances');
    });
  });

  test('Un voluntario también puede cargar el conteo', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    and('que hay un voluntario en la organización', async () => {
      const organizationId = mundo().datos.get('organizationId') as string;
      await mundo().unMiembroConRol('voluntario', 'voluntario', organizationId);
    });

    when(
      /^el voluntario registra que hoy asistieron (\d+) beneficiarios$/,
      async (cantidad: string) => {
        mundo().respuesta = await cargarAsistencia(
          'voluntario',
          evento().id,
          hoy(),
          Number(cantidad),
        );
      },
    );

    then(/^el conteo de hoy queda guardado en (\d+)$/, (cantidad: string) => {
      expect(mundo().ultimaRespuesta().status).toBe(200);
      const body = mundo().ultimaRespuesta().body as { count: number };
      expect(body.count).toBe(Number(cantidad));
    });
  });

  test('Otra organización no puede cargar asistencia en mi evento', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    and('que existe otra organización con su propio responsable', async () => {
      await unaOrganizacion('otra');
    });

    when(
      /^el responsable de la otra organización intenta registrar asistencia en el evento "(.*)"$/,
      async () => {
        mundo().respuesta = await cargarAsistencia(
          'otra',
          evento().id,
          hoy(),
          10,
        );
      },
    );

    then('el sistema no se lo permite', () => {
      expect(mundo().ultimaRespuesta().status).toBe(404);
    });

    and(
      'el responsable sí puede registrar la asistencia en su propio evento',
      async () => {
        const res = await cargarAsistencia('usuario', evento().id, hoy(), 10);
        expect(res.status).toBe(200);
      },
    );
  });

  test('No se puede cargar la asistencia de un día que todavía no llegó', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    when(
      'el responsable intenta registrar la asistencia de mañana',
      async () => {
        mundo().respuesta = await cargarAsistencia(
          'usuario',
          evento().id,
          sumarDias(hoy(), 1),
          10,
        );
      },
    );

    then('el sistema no se lo permite', () => {
      expect(mundo().ultimaRespuesta().status).toBe(400);
    });
  });

  test('No se puede cargar asistencia en una fecha que no es ocurrencia del evento', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    and(
      /^que existe un evento extraordinario para la fecha de hace (\d+) días$/,
      async (dias: string) => {
        const res = await mundo()
          .http()
          .post('/events')
          .set('Authorization', mundo().auth('usuario'))
          .send({
            name: 'Colecta puntual',
            kind: 'one_off',
            startDate: sumarDias(hoy(), -Number(dias)),
            startTime: '17:00',
          });
        mundo().datos.set('eventoExtraordinario', res.body as EventoBody);
      },
    );

    when(
      /^el responsable intenta registrar asistencia de hace (\d+) días en ese evento$/,
      async (dias: string) => {
        const eventoExtraordinario = mundo().datos.get(
          'eventoExtraordinario',
        ) as EventoBody;
        mundo().respuesta = await cargarAsistencia(
          'usuario',
          eventoExtraordinario.id,
          sumarDias(hoy(), -Number(dias)),
          10,
        );
      },
    );

    then('el sistema no se lo permite', () => {
      expect(mundo().ultimaRespuesta().status).toBe(400);
    });
  });
});
