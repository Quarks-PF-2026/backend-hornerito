# language: es
Característica: Smoke del harness de aceptación
  Verifica que jest-cucumber parsea Gherkin en español y corre bajo Jest 30.
  Este archivo no prueba negocio: prueba el harness. No lo borres.

  Escenario: El harness ejecuta un escenario en español
    Dado que el harness está configurado
    Cuando se ejecuta un escenario de prueba
    Entonces el escenario se reporta como ejecutado
