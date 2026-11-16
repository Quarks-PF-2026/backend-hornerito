import { defineFeature, loadFeature, DefineStepFunction } from 'jest-cucumber';
import { usarMundo } from './support/world';

const feature = loadFeature('./test/acceptance/QK-115.feature');

interface FilaTop {
  position: number;
  userId: string;
  name: string;
  total: number;
}

type Tabla = Array<Record<string, string>>;

defineFeature(feature, (test) => {
  const mundo = usarMundo();

  const topDonors = (): FilaTop[] => {
    expect(mundo().ultimaRespuesta().status).toBe(200);
    const body = mundo().ultimaRespuesta().body as { topDonors?: FilaTop[] };
    // `toBeDefined` primero: sin él, una ficha que todavía no trae la sección
    // haría pasar "la ficha no muestra donantes" por la razón equivocada.
    expect(body.topDonors).toBeDefined();
    return body.topDonors!;
  };

  const recibieron = (given: DefineStepFunction) => {
    given('que se recibieron estas donaciones:', (tabla: Tabla) =>
      mundo().lasDonaciones(tabla),
    );
  };

  const entraALaFicha = (when: DefineStepFunction) => {
    when(
      /^un visitante sin cuenta entra a la ficha de "(.*)"$/,
      async (organizacion: string) => {
        mundo().respuesta = await mundo()
          .http()
          .get(`/public/organizations/${mundo().organizacion(organizacion)}`);
      },
    );
  };

  const veLosDonantes = (then: DefineStepFunction) => {
    then('ve los donantes del mes de la organización:', (tabla: Tabla) => {
      expect(
        topDonors().map(({ position, userId, name, total }) => ({
          position,
          userId,
          name,
          total,
        })),
      ).toEqual(
        tabla.map((fila) => ({
          position: Number(fila['posición']),
          userId: mundo().sesion(fila['donante']).userId,
          name: fila['donante'],
          total: Number(fila['monto']),
        })),
      );
    });
  };

  const fichaVacia = (then: DefineStepFunction) => {
    then('la ficha no muestra donantes del mes', () => {
      expect(topDonors()).toEqual([]);
    });
  };

  test('La ficha muestra a los que más le donaron este mes', ({
    given,
    when,
    then,
  }) => {
    recibieron(given);
    entraALaFicha(when);
    veLosDonantes(then);
  });

  test('Cada ficha cuenta solo lo donado a esa organización', ({
    given,
    when,
    then,
  }) => {
    recibieron(given);
    entraALaFicha(when);
    veLosDonantes(then);
  });

  test('Con más de cinco donantes se muestran solo los cinco primeros', ({
    given,
    when,
    then,
  }) => {
    given(
      /^que (\d+) personas donaron este mes montos distintos a "(.*)"$/,
      (cantidad: string, organizacion: string) => {
        mundo().datos.set('donantes', Number(cantidad));
        return mundo().variosDonantes(Number(cantidad), organizacion);
      },
    );

    entraALaFicha(when);

    then(
      /^ve (\d+) donantes, del que más donó en adelante$/,
      (cantidad: string) => {
        // `variosDonantes(n)` dona 1000·i: el primero es "Donante n" con n·1000.
        const n = mundo().datos.get('donantes') as number;
        expect(topDonors().map((f) => [f.position, f.name, f.total])).toEqual(
          Array.from({ length: Number(cantidad) }, (_, i) => [
            i + 1,
            `Donante ${String(n - i).padStart(2, '0')}`,
            (n - i) * 1000,
          ]),
        );
      },
    );
  });

  test('Las donaciones anónimas y las que falta confirmar no aparecen', ({
    given,
    when,
    then,
  }) => {
    recibieron(given);
    entraALaFicha(when);
    veLosDonantes(then);
  });

  test('Sin donaciones este mes la sección queda vacía', ({
    given,
    when,
    then,
  }) => {
    recibieron(given);
    entraALaFicha(when);
    fichaVacia(then);
  });

  test('Una organización sin datos para recibir donaciones no muestra el top', ({
    given,
    and,
    when,
    then,
  }) => {
    recibieron(given);

    and(
      /^que "(.*)" ya no tiene cargados sus datos para recibir donaciones$/,
      async (organizacion: string) => {
        await mundo().dataSource.query(
          `UPDATE organizations
              SET "paymentAlias" = NULL, "paymentHolder" = NULL, "paymentBank" = NULL
            WHERE id = $1`,
          [mundo().organizacion(organizacion)],
        );
      },
    );

    entraALaFicha(when);
    fichaVacia(then);
  });

  test('Cada organización muestra solo a sus propios donantes', ({
    given,
    when,
    then,
  }) => {
    recibieron(given);
    entraALaFicha(when);
    veLosDonantes(then);
    entraALaFicha(when);
    veLosDonantes(then);
  });
});
