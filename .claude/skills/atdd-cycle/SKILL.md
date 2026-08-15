---
name: atdd-cycle
description: Use cuando se va a desarrollar una user story completa de Hornerito (típicamente disparada por /us QK-NN), cuando hay que arreglar un bug que debería quedar cubierto por un escenario, o cuando el usuario pregunta cómo funciona el ciclo ATDD del proyecto. Do NOT use para cambios triviales, config, o tareas sin requisito de negocio detrás.
---

# Ciclo ATDD de Hornerito

El orden importa y no es negociable: **el escenario de aceptación se escribe antes que la implementación**. Reglas de fondo en `CLAUDE.md` §3; acá está el procedimiento.

## Paso 0 — Traer el ticket

```
npm run jira:import
```

Lee `.jira/QK-NN.md`. Si no existe, el dev tiene que exportar el sprint desde Jira a `.jira/raw/` primero (`CLAUDE.md` §9).

**Si el ticket no trae criterios de aceptación, el ciclo se detiene acá.** No los inventes: acordalos con el usuario y anotalos en el ticket antes de seguir. Un escenario derivado de criterios inventados valida una historia que nadie pidió.

## Paso 1 — Gate de dominio

Delegá a `hornerito-domain-expert` **antes de escribir nada**. Pasale el ticket y preguntale si los criterios son consistentes con `DOMAIN.md`.

- `VEREDICTO: consistente` → seguí.
- `[VIOLA REGLA]` → no se implementa. El ticket está mal o la regla cambió; que lo resuelva el usuario.
- `[NO CONFIRMADO]` → **pará y preguntá al usuario** con `AskUserQuestion`. El default ante una regla no confirmada es preguntar, no ejecutar. Cuando el usuario responda, la respuesta se promueve a regla en `DOMAIN.md`.

## Paso 2 — Escenarios, en RED

Delegá a `atdd-author`. Escribe `test/acceptance/QK-NN.feature` y `QK-NN.steps.ts`.

Cobertura mínima: camino feliz, un caso de error o validación, y — si la historia toca datos de organización — un escenario de **aislamiento entre organizaciones**. Ese último es la invariante 1 de `DOMAIN.md` y es el que más se olvida.

**Gate RED.** El agente cierra corriendo la suite y **esperando que falle**:

```
HN_TEST_GATE=agent npm run test:acceptance
```

Si pasa en verde, el escenario no está probando nada — se rechaza y se reescribe. Este gate es lo único que separa ATDD de escribir tests después de implementar; no lo saltees "porque es obvio que va a fallar".

## Paso 3 — Implementar hasta GREEN

¿Toca esquema, migraciones o RLS? → `tenancy-migration-expert` primero, y verifica contra base limpia.
Todo lo demás → `nestjs-expert`.

El agente cierra con la aceptación en verde **y** sin regresión en unit. Si después de dos intentos la aceptación sigue roja, para y reporta: seguir tocando código a ciegas es peor que pedir ayuda.

## Paso 4 — Documentar la decisión

¿Hubo una decisión cara de revertir, o que un integrante podría cuestionar? → `architecture-scribe` escribe el ADR en `../lab-hornerito/` (`CLAUDE.md` §7).

Si no hubo decisión arquitectónica, saltealo. No todo cambio merece un ADR, y un repositorio de ADRs triviales es peor que ninguno.

## Paso 5 — Review y cierre

`code-reviewer` con `SUMMARY: ship`. Después, el commit lo pide el usuario (`CLAUDE.md` §8).

## Bugs

Un bug se reproduce **primero** como escenario de aceptación, después se arregla. El escenario queda como regresión permanente. Un bug sin escenario vuelve.

## Errores frecuentes

| Síntoma | Qué pasó |
|---|---|
| El `.feature` menciona endpoints, tablas o códigos HTTP | Está escrito en lenguaje técnico. El `.feature` lo tiene que poder revisar alguien que no programa; lo técnico va en el `.steps.ts` |
| El gate RED pasa en verde | El escenario no ejercita nada nuevo, o los steps no llegan a hacer la petición. Revisá que el `Cuando` realmente pegue contra la app |
| La aceptación falla con un error de conexión | Falta `npm run db:test:up`, o `DATABASE_URL` no apunta a una base terminada en `_test` |
| Un escenario pasa solo cuando corre aislado | Falta limpieza. Registrá lo que creaste en el mundo (`registrarOrganizacion` / `registrarEmail`) para que el `afterEach` lo alcance |
| Se repite el mismo bloque de setup en varios `.steps.ts` | Esa precondición va a `world.ts`, no copiada en cada archivo |
