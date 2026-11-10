import { JwtService } from '@nestjs/jwt';
import { defineFeature, loadFeature, DefineStepFunction } from 'jest-cucumber';
import { usarMundo } from './support/world';

const feature = loadFeature('./test/acceptance/QK-113.feature');

interface DonacionPersistida {
  donorUserId: string | null;
  isAnonymous: boolean;
}

interface DonacionDelHistorial {
  id: string;
  organizationId: string;
  organizationName: string;
  amount: number;
  status: string;
  isAnonymous: boolean;
  createdAt: string;
}

interface DonacionDelPanel {
  id: string;
  amount: number;
  donorName: string | null;
  donorContact: string | null;
}

defineFeature(feature, (test) => {
  const mundo = usarMundo();

  /**
   * Declarar desde la ficha pública. `alias` null = visitante sin sesión; con
   * alias, se manda el token que tenga guardada esa sesión (válido, vencido o
   * inválido, según lo haya dejado el `Dado`).
   */
  const declarar = async (
    alias: string | null,
    organizacion: string,
    campos: Record<string, string>,
  ) => {
    const req = mundo()
      .http()
      .post(
        `/public/organizations/${mundo().organizacion(organizacion)}/donations`,
      )
      .field({ method: 'transferencia', ...campos });
    if (alias) req.set('Authorization', mundo().auth(alias));
    mundo().respuesta = await req;
    if (mundo().respuesta?.status === 201) {
      const ids = (mundo().datos.get('donaciones') as string[]) ?? [];
      mundo().datos.set('donaciones', [
        ...ids,
        (mundo().respuesta!.body as { id: string }).id,
      ]);
    }
  };

  const ultimaDonacion = (): string => {
    const ids = mundo().datos.get('donaciones') as string[] | undefined;
    if (!ids?.length) throw new Error('No se registró ninguna donación.');
    return ids[ids.length - 1];
  };

  const persistida = async (id: string): Promise<DonacionPersistida> => {
    const [fila]: DonacionPersistida[] = await mundo().dataSource.query(
      `SELECT "donorUserId", "isAnonymous" FROM donations WHERE id = $1`,
      [id],
    );
    return fila;
  };

  const panel = async (organizacion: string): Promise<DonacionDelPanel[]> => {
    const res = await mundo()
      .http()
      .get('/donations/monetary')
      .set('Authorization', mundo().auth(`responsable:${organizacion}`))
      .expect(200);
    return res.body as DonacionDelPanel[];
  };

  /** "Mis donaciones". `alias` null = visitante sin sesión. */
  const historial = async (alias: string | null) => {
    const req = mundo().http().get('/profile/donations');
    if (alias) req.set('Authorization', mundo().auth(alias));
    mundo().respuesta = await req;
  };

  const historialRecibido = (): DonacionDelHistorial[] => {
    expect(mundo().ultimaRespuesta().status).toBe(200);
    return mundo().ultimaRespuesta().body as DonacionDelHistorial[];
  };

  /** Precondición: una donación ya declarada con éxito desde la ficha pública. */
  const yaDeclaro = (step: DefineStepFunction) => {
    step(
      /^que (.*) declaró una donación de \$(\d+) a "([^"]*)"$/,
      async (nombre: string, monto: string, organizacion: string) => {
        await declarar(nombre, organizacion, { amount: monto });
        expect(mundo().ultimaRespuesta().status).toBe(201);
      },
    );
  };

  const entraAMisDonaciones = (step: DefineStepFunction) => {
    step(/^(.*) entra a "Mis donaciones"$/, (nombre: string) =>
      historial(nombre),
    );
  };

  const veSoloLaDonacion = (step: DefineStepFunction) => {
    step(
      /^ve en su historial solo la donación de \$(\d+)$/,
      (monto: string) => {
        expect(historialRecibido().map((d) => d.amount)).toEqual([
          Number(monto),
        ]);
      },
    );
  };

  const tambienRecibe = (step: DefineStepFunction) => {
    step(
      /^que "(.*)" también recibe donaciones por transferencia$/,
      async (organizacion: string) => {
        await mundo().unaOrganizacionQueRecibeDonaciones(organizacion);
      },
    );
  };

  const antecedentes = (given: DefineStepFunction, and: DefineStepFunction) => {
    given(
      /^que "(.*)" recibe donaciones por transferencia$/,
      async (organizacion: string) => {
        await mundo().unaOrganizacionQueRecibeDonaciones(organizacion);
      },
    );
    and(
      /^que (.*) tiene cuenta y la sesión iniciada$/,
      async (nombre: string) => {
        await mundo().unDonante(nombre);
      },
    );
  };

  const conSesionDeclara = (step: DefineStepFunction) => {
    step(
      /^(.*) declara una donación de \$(\d+) a "([^"]*)"$/,
      (nombre: string, monto: string, organizacion: string) =>
        declarar(nombre, organizacion, { amount: monto }),
    );
  };

  const quedaRegistrada = (then: DefineStepFunction) => {
    then('la donación queda registrada', () => {
      expect(mundo().ultimaRespuesta().status).toBe(201);
      expect(mundo().ultimaRespuesta().body).toMatchObject({
        status: 'declarada',
      });
    });
  };

  const asociadaA = (and: DefineStepFunction) => {
    and(/^queda asociada a la cuenta de (.*)$/, async (nombre: string) => {
      expect(await persistida(ultimaDonacion())).toEqual({
        donorUserId: mundo().sesion(nombre).userId,
        isAnonymous: false,
      });
    });
  };

  const sinCuenta = (and: DefineStepFunction) => {
    and('no queda asociada a ninguna cuenta', async () => {
      expect(await persistida(ultimaDonacion())).toEqual({
        donorUserId: null,
        isAnonymous: false,
      });
    });
  };

  const veEnSuPanel = (and: DefineStepFunction) => {
    and(
      /^"(.*)" ve en su panel el nombre "(.*)" y el contacto "(.*)"$/,
      async (organizacion: string, nombre: string, contacto: string) => {
        const donacion = (await panel(organizacion)).find(
          (d) => d.id === ultimaDonacion(),
        );
        expect(donacion).toMatchObject({
          donorName: nombre,
          donorContact: contacto,
        });
      },
    );
  };

  test('Donar con la sesión iniciada asocia la donación a la cuenta', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);
    conSesionDeclara(when);
    quedaRegistrada(then);
    asociadaA(and);
  });

  test('Donar sin sesión sigue funcionando como siempre', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    when(
      /^un visitante sin sesión declara una donación de \$(\d+) a "([^"]*)"$/,
      (monto: string, organizacion: string) =>
        declarar(null, organizacion, { amount: monto }),
    );

    quedaRegistrada(then);
    sinCuenta(and);
  });

  test('Una donación anónima queda en la cuenta pero no se muestra en público', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    when(
      /^(.*) declara una donación anónima de \$(\d+) a "(.*)" firmando "(.*)" con contacto "(.*)"$/,
      (
        nombre: string,
        monto: string,
        organizacion: string,
        firma: string,
        contacto: string,
      ) =>
        declarar(nombre, organizacion, {
          amount: monto,
          donorName: firma,
          donorContact: contacto,
          isAnonymous: 'true',
        }),
    );

    quedaRegistrada(then);

    and(
      /^queda asociada a la cuenta de (.*) como anónima$/,
      async (nombre: string) => {
        expect(await persistida(ultimaDonacion())).toEqual({
          donorUserId: mundo().sesion(nombre).userId,
          isAnonymous: true,
        });
      },
    );

    veEnSuPanel(and);

    when(/^"(.*)" confirma que la recibió$/, async (organizacion: string) => {
      await mundo().confirmarDonacion(organizacion, ultimaDonacion());
    });

    then(
      /^(.*) no figura en el ranking de donantes del mes del inicio$/,
      async (nombre: string) => {
        const res = await mundo().http().get('/public/donors/top');
        expect(res.status).toBe(200);
        const crudo = JSON.stringify(res.body);
        expect(crudo).not.toContain(mundo().sesion(nombre).userId);
        expect(crudo).not.toContain(nombre);
      },
    );
  });

  test('El nombre y el contacto que edita el donante quedan en la donación, no en su cuenta', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    when(
      /^(.*) declara una donación de \$(\d+) a "(.*)" firmando "(.*)" con contacto "(.*)"$/,
      (
        nombre: string,
        monto: string,
        organizacion: string,
        firma: string,
        contacto: string,
      ) =>
        declarar(nombre, organizacion, {
          amount: monto,
          donorName: firma,
          donorContact: contacto,
        }),
    );

    quedaRegistrada(then);
    asociadaA(and);
    veEnSuPanel(and);

    and(
      /^la cuenta de (.*) conserva su nombre y su correo$/,
      async (nombre: string) => {
        const sesion = mundo().sesion(nombre);
        const [cuenta]: Array<{ name: string; email: string }> =
          await mundo().dataSource.query(
            `SELECT name, email FROM users WHERE id = $1`,
            [sesion.userId],
          );
        expect(cuenta).toEqual({ name: nombre, email: sesion.email });
      },
    );
  });

  test('Una donación sin sesión no se asocia a una cuenta aunque coincidan nombre y correo', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    when(
      /^un visitante sin sesión declara una donación de \$(\d+) a "(.*)" firmando con el nombre y el correo de la cuenta de (.*)$/,
      (monto: string, organizacion: string, nombre: string) =>
        declarar(null, organizacion, {
          amount: monto,
          donorName: nombre,
          donorContact: mundo().sesion(nombre).email,
        }),
    );

    quedaRegistrada(then);
    sinCuenta(and);
  });

  test('Cada organización ve en su panel solo la donación que recibió', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);
    tambienRecibe(and);

    conSesionDeclara(when);
    conSesionDeclara(and);

    then(
      /^"(.*)" ve en su panel solo la donación de \$(\d+)$/,
      async (organizacion: string, monto: string) => {
        expect((await panel(organizacion)).map((d) => d.amount)).toEqual([
          Number(monto),
        ]);
      },
    );

    and(
      /^"(.*)" ve en su panel solo la donación de \$(\d+)$/,
      async (organizacion: string, monto: string) => {
        expect((await panel(organizacion)).map((d) => d.amount)).toEqual([
          Number(monto),
        ]);
      },
    );

    and(
      /^las dos donaciones quedan asociadas a la cuenta de (.*)$/,
      async (nombre: string) => {
        const ids = mundo().datos.get('donaciones') as string[];
        expect(ids).toHaveLength(2);
        for (const id of ids) {
          expect(await persistida(id)).toEqual({
            donorUserId: mundo().sesion(nombre).userId,
            isAnonymous: false,
          });
        }
      },
    );
  });

  test('Con la sesión vencida se dona como visitante', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    given(/^que la sesión de (.*) está vencida$/, (nombre: string) => {
      const sesion = mundo().sesion(nombre);
      // Firmado con el secreto real, para que lo único mal sea el vencimiento.
      const token = mundo()
        .app.get(JwtService)
        .sign({ sub: sesion.userId, email: sesion.email }, { expiresIn: -60 });
      mundo().sesiones.set(nombre, { ...sesion, token });
    });

    conSesionDeclara(when);
    quedaRegistrada(then);
    sinCuenta(and);
  });

  test('Con una sesión inválida se dona como visitante', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    given(/^que la sesión de (.*) no es válida$/, (nombre: string) => {
      const sesion = mundo().sesion(nombre);
      // Vigente pero firmado con otro secreto: un token adulterado.
      const token = mundo()
        .app.get(JwtService)
        .sign(
          { sub: sesion.userId, email: sesion.email },
          { secret: 'un-secreto-que-no-es-el-del-servidor' },
        );
      mundo().sesiones.set(nombre, { ...sesion, token });
    });

    conSesionDeclara(when);
    quedaRegistrada(then);
    sinCuenta(and);
  });

  test('El donante ve su historial en "Mis donaciones"', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);
    tambienRecibe(given);
    yaDeclaro(and);

    and(
      /^que "(.*)" confirmó que la recibió$/,
      async (organizacion: string) => {
        await mundo().confirmarDonacion(organizacion, ultimaDonacion());
      },
    );

    and(
      /^que (.*) declaró una donación anónima de \$(\d+) a "([^"]*)"$/,
      async (nombre: string, monto: string, organizacion: string) => {
        await declarar(nombre, organizacion, {
          amount: monto,
          isAnonymous: 'true',
        });
        expect(mundo().ultimaRespuesta().status).toBe(201);
      },
    );

    and(
      /^que un visitante sin sesión declaró una donación de \$(\d+) a "([^"]*)"$/,
      async (monto: string, organizacion: string) => {
        await declarar(null, organizacion, { amount: monto });
        expect(mundo().ultimaRespuesta().status).toBe(201);
      },
    );

    entraAMisDonaciones(when);

    then(
      /^ve en su historial, de la más nueva a la más vieja:$/,
      (filas: Array<Record<string, string>>) => {
        const estados: Record<string, string> = {
          confirmada: 'confirmada',
          'a confirmar': 'declarada',
          rechazada: 'rechazada',
        };
        const donaciones = historialRecibido();
        // toMatchObject sobre el array exige el mismo largo: la del visitante
        // sin sesión no puede colarse.
        expect(donaciones).toMatchObject(
          filas.map((f) => ({
            organizationId: mundo().organizacion(f['organización']),
            amount: Number(f['monto']),
            status: estados[f['estado']],
            isAnonymous: f['anónima'] === 'sí',
          })),
        );
        // El helper le agrega un sufijo único al nombre de la organización.
        donaciones.forEach((d, i) =>
          expect(d.organizationName).toContain(filas[i]['organización']),
        );
        const fechas = donaciones.map((d) => Date.parse(d.createdAt));
        expect(fechas.every((t) => !Number.isNaN(t))).toBe(true);
        expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
      },
    );
  });

  test('Cada donante ve solo sus propias donaciones', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);

    given(
      /^que (.*) también tiene cuenta y la sesión iniciada$/,
      async (nombre: string) => {
        await mundo().unDonante(nombre);
      },
    );

    yaDeclaro(and);
    yaDeclaro(and);
    entraAMisDonaciones(when);
    veSoloLaDonacion(then);
    entraAMisDonaciones(when);
    veSoloLaDonacion(then);
  });

  test('Sin sesión no se puede ver ningún historial de donaciones', ({
    given,
    and,
    when,
    then,
  }) => {
    antecedentes(given, and);
    yaDeclaro(given);

    when('un visitante sin sesión intenta entrar a "Mis donaciones"', () =>
      historial(null),
    );

    then('el sistema le pide iniciar sesión', () => {
      expect(mundo().ultimaRespuesta().status).toBe(401);
    });
  });
});
