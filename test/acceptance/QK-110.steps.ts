import { defineFeature, loadFeature, DefineStepFunction } from 'jest-cucumber';
import { usarMundo } from './support/world';

const feature = loadFeature('./test/acceptance/QK-110.feature');

interface PerfilDonante {
  userId: string;
  name: string;
  memberSince: string;
  monthTotal: number;
  totalAmount: number;
}

type Tabla = Array<Record<string, string>>;

const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

defineFeature(feature, (test) => {
  const mundo = usarMundo();

  const verPerfil = async (userId: string) => {
    mundo().respuesta = await mundo().http().get(`/public/donors/${userId}`);
  };

  const perfil = (): PerfilDonante => {
    expect(mundo().ultimaRespuesta().status).toBe(200);
    return mundo().ultimaRespuesta().body as PerfilDonante;
  };

  const recibieron = (step: DefineStepFunction) => {
    step('que se recibieron estas donaciones:', (tabla: Tabla) =>
      mundo().lasDonaciones(tabla),
    );
  };

  const entraAlPerfil = (when: DefineStepFunction) => {
    when(
      /^un visitante sin cuenta entra al perfil de (.*)$/,
      (nombre: string) => verPerfil(mundo().sesion(nombre).userId),
    );
  };

  const veLosTotales = (step: DefineStepFunction) => {
    step(
      /^ve que este mes donó \$(\d+) y en total \$(\d+)$/,
      (mes: string, total: string) => {
        const body = perfil();
        expect(body.monthTotal).toBe(Number(mes));
        expect(body.totalAmount).toBe(Number(total));
      },
    );
  };

  const noValidada = (and: DefineStepFunction) => {
    and(/^que "(.*)" no está validada$/, async (organizacion: string) => {
      await mundo().dataSource.query(
        `UPDATE organizations SET status = 'pending' WHERE id = $1`,
        [mundo().organizacion(organizacion)],
      );
    });
  };

  test('Un visitante sin cuenta entra al perfil de un donante del ranking', ({
    given,
    and,
    when,
    then,
  }) => {
    given(
      /^que (.*) tiene cuenta desde (\w+) de (\d{4})$/,
      async (nombre: string, mes: string, anio: string) => {
        const donante = await mundo().unDonante(nombre);
        const alta = new Date(Date.UTC(Number(anio), MESES[mes] - 1, 15, 15));
        await mundo().dataSource.query(
          // `users."createdAt"` es `timestamp` sin zona en UTC: va como ISO y
          // se convierte explícito (ver `unaDonacionEconomica` en world.ts).
          `UPDATE users SET "createdAt" = ($1::timestamptz AT TIME ZONE 'UTC') WHERE id = $2`,
          [alta.toISOString(), donante.userId],
        );
      },
    );

    recibieron(and);

    when(
      /^un visitante sin cuenta entra al perfil de (.*) desde el ranking del inicio$/,
      async (nombre: string) => {
        const ranking = await mundo().http().get('/public/donors/top');
        expect(ranking.status).toBe(200);
        const fila = (
          ranking.body as Array<{ userId: string; name: string }>
        ).find((f) => f.name === nombre);
        expect(fila).toBeDefined();
        await verPerfil(fila!.userId);
      },
    );

    then(
      /^ve que se llama "(.*)" y que es donante desde (\w+) de (\d{4})$/,
      (nombre: string, mes: string, anio: string) => {
        const body = perfil();
        expect(body.name).toBe(nombre);
        expect(body.userId).toBe(mundo().sesion(nombre).userId);
        // Mes y año de alta leídos en hora de Argentina, como los ve el visitante.
        const [y, m] = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Argentina/Buenos_Aires',
        })
          .format(new Date(body.memberSince))
          .split('-')
          .map(Number);
        expect([y, m]).toEqual([Number(anio), MESES[mes]]);
      },
    );

    veLosTotales(and);
  });

  test('El perfil no muestra datos de contacto ni a qué organizaciones donó', ({
    given,
    and,
    when,
    then,
  }) => {
    recibieron(given);

    and(
      /^que (.*) tiene cargado el teléfono "(.*)" en su cuenta$/,
      async (nombre: string, telefono: string) => {
        await mundo().dataSource.query(
          `UPDATE users SET phone = $1 WHERE id = $2`,
          [telefono, mundo().sesion(nombre).userId],
        );
        mundo().datos.set('telefono', telefono);
      },
    );

    entraAlPerfil(when);

    then(
      'no ve su correo, ni su teléfono, ni las organizaciones a las que donó',
      () => {
        const body = perfil();
        const crudo = JSON.stringify(body);
        expect(crudo).not.toContain('@');
        expect(crudo).not.toContain(mundo().datos.get('telefono') as string);
        expect(crudo).not.toContain(mundo().organizacion('Comedor Los Pibes'));
        expect(crudo).not.toContain('Comedor');
        expect(Object.keys(body).sort()).toEqual([
          'memberSince',
          'monthTotal',
          'name',
          'totalAmount',
          'userId',
        ]);
      },
    );
  });

  test('Solo suma lo confirmado, a la vista y a organizaciones validadas', ({
    given,
    and,
    when,
    then,
  }) => {
    recibieron(given);
    noValidada(and);
    entraAlPerfil(when);
    veLosTotales(then);
  });

  test('Una cuenta sin donaciones públicas confirmadas no tiene perfil', ({
    given,
    when,
    then,
  }) => {
    recibieron(given);
    entraAlPerfil(when);

    then('el perfil no existe', () => {
      expect(mundo().ultimaRespuesta().status).toBe(404);
    });
  });
});
