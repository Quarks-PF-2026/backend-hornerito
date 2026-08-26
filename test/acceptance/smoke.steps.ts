import { defineFeature, loadFeature } from 'jest-cucumber';

const feature = loadFeature('./test/acceptance/smoke.feature');

defineFeature(feature, (test) => {
  test('El harness ejecuta un escenario en español', ({
    given,
    when,
    then,
  }) => {
    let ejecutado = false;

    given('que el harness está configurado', () => {
      ejecutado = false;
    });

    when('se ejecuta un escenario de prueba', () => {
      ejecutado = true;
    });

    then('el escenario se reporta como ejecutado', () => {
      expect(ejecutado).toBe(true);
    });
  });
});
