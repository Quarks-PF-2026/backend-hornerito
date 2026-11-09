import { defineFeature, loadFeature, DefineStepFunction } from 'jest-cucumber';
import { usarMundo } from './support/world';

const feature = loadFeature('./test/acceptance/QK-114.feature');

interface FilaRanking {
  position: number;
  userId: string;
  name: string;
  total: number;
}

type Tabla = Array<Record<string, string>>;

defineFeature(feature, (test) => {
  const mundo = usarMundo();

  /**
   * El ranking es global: se compara la respuesta entera, no recortada a los
   * donantes del escenario. Vale porque la aceptación corre `--runInBand`
   * contra una base efímera y cada escenario borra lo suyo al cerrar.
   */
  const entrarAlInicio = async () => {
    mundo().respuesta = await mundo().http().get('/public/donors/top');
  };

  const ranking = (): FilaRanking[] => {
    expect(mundo().ultimaRespuesta().status).toBe(200);
    return mundo().ultimaRespuesta().body as FilaRanking[];
  };

  const esperado = (tabla: Tabla) =>
    tabla.map((fila) => ({
      position: Number(fila['posición']),
      userId: mundo().sesion(fila['donante']).userId,
      name: fila['donante'],
      total: Number(fila['monto']),
    }));

  const recibieron = (given: DefineStepFunction) => {
    given('que se recibieron estas donaciones:', (tabla: Tabla) =>
      mundo().lasDonaciones(tabla),
    );
  };

  const visitanteEntra = (when: DefineStepFunction) => {
    when('un visitante sin cuenta entra al inicio', entrarAlInicio);
  };

  const veElRanking = (then: DefineStepFunction) => {
    then('ve el ranking de donantes del mes:', (tabla: Tabla) => {
      expect(
        ranking().map(({ position, userId, name, total }) => ({
          position,
          userId,
          name,
          total,
        })),
      ).toEqual(esperado(tabla));
    });
  };

  test('Un visitante sin cuenta ve a los que más donaron este mes', ({
    given,
    when,
    then,
    and,
  }) => {
    recibieron(given);
    visitanteEntra(when);
    veElRanking(then);

    and('el ranking no muestra el correo ni el contacto de nadie', () => {
      const crudo = JSON.stringify(mundo().ultimaRespuesta().body);
      // Las donaciones de la tabla se cargan con el email de la cuenta como
      // contacto: si alguno se filtra, aparece una arroba.
      expect(crudo).not.toContain('@');
      for (const fila of ranking()) {
        expect(Object.keys(fila).sort()).toEqual([
          'name',
          'position',
          'total',
          'userId',
        ]);
      }
    });
  });

  test('Lo donado a distintas organizaciones se suma en una sola fila', ({
    given,
    when,
    then,
  }) => {
    recibieron(given);
    visitanteEntra(when);
    veElRanking(then);
  });

  test('Solo cuenta lo que la organización ya confirmó', ({
    given,
    when,
    then,
    and,
  }) => {
    recibieron(given);
    visitanteEntra(when);
    veElRanking(then);

    when(
      /^"(.*)" confirma que recibió los \$(\d+) de (.*)$/,
      async (organizacion: string, monto: string, donante: string) => {
        const [{ id }]: Array<{ id: string }> = await mundo().dataSource.query(
          `SELECT id FROM donations
            WHERE "organizationId" = $1 AND "donorUserId" = $2
              AND status = 'declarada' AND amount = $3`,
          [
            mundo().organizacion(organizacion),
            mundo().sesion(donante).userId,
            Number(monto),
          ],
        );
        await mundo().confirmarDonacion(organizacion, id);
      },
    );

    and('un visitante sin cuenta vuelve a entrar al inicio', entrarAlInicio);

    veElRanking(then);
  });

  test('Las donaciones anónimas no figuran ni se le suman a otro', ({
    given,
    and,
    when,
    then,
  }) => {
    recibieron(given);

    and(
      /^que alguien sin cuenta donó \$(\d+) a "(.*)" firmando como "(.*)"$/,
      async (monto: string, organizacion: string, nombre: string) => {
        await mundo().unaDonacionEconomica({
          organizationId: mundo().organizacion(organizacion),
          amount: Number(monto),
          donorUserId: null,
          donorName: nombre,
        });
      },
    );

    visitanteEntra(when);
    veElRanking(then);
  });

  test('El mes se corta en hora de Argentina', ({ given, when, then }) => {
    recibieron(given);
    visitanteEntra(when);
    veElRanking(then);
  });

  test('Ante un empate queda arriba quien llegó primero a ese monto', ({
    given,
    when,
    then,
    and,
  }) => {
    recibieron(given);
    visitanteEntra(when);
    veElRanking(then);

    and('cada vez que vuelve a entrar ve el mismo orden', async () => {
      const primero = ranking().map((f) => f.userId);
      for (let i = 0; i < 3; i++) {
        await entrarAlInicio();
        expect(ranking().map((f) => f.userId)).toEqual(primero);
      }
    });
  });

  test('Un mes sin donaciones deja el ranking vacío', ({
    given,
    when,
    then,
  }) => {
    recibieron(given);
    visitanteEntra(when);

    then('el ranking de donantes del mes está vacío', () => {
      expect(ranking()).toEqual([]);
    });
  });

  test('Lo donado a una organización no validada no cuenta', ({
    given,
    and,
    when,
    then,
  }) => {
    recibieron(given);

    and(/^que "(.*)" no está validada$/, async (organizacion: string) => {
      await mundo().dataSource.query(
        `UPDATE organizations SET status = 'pending' WHERE id = $1`,
        [mundo().organizacion(organizacion)],
      );
    });

    visitanteEntra(when);
    veElRanking(then);
  });

  test('Con más de diez donantes se muestran solo los diez primeros', ({
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

    visitanteEntra(when);

    then(
      /^ve (\d+) donantes, del que más donó en adelante$/,
      (cantidad: string) => {
        // `variosDonantes(n)` dona 1000·i: el primero es "Donante n" con n·1000.
        const n = mundo().datos.get('donantes') as number;
        const filas = ranking();
        expect(filas).toHaveLength(Number(cantidad));
        expect(filas.map((f) => [f.position, f.name, f.total])).toEqual(
          Array.from({ length: Number(cantidad) }, (_, i) => [
            i + 1,
            `Donante ${String(n - i).padStart(2, '0')}`,
            (n - i) * 1000,
          ]),
        );
      },
    );
  });
});
