---
description: Desarrolla una user story completa siguiendo el ciclo ATDD (uso: /us QK-26)
argument-hint: <QK-NN>
---

Desarrollá la user story **$1** siguiendo el ciclo ATDD del proyecto.

Invocá la skill `atdd-cycle` y seguí sus pasos en orden, sin saltear ninguno. Los gates son bloqueantes: si uno no pasa, se para y se reporta en vez de avanzar.

Recordatorios que se olvidan seguido:

- El **gate RED** es obligatorio aunque parezca obvio que va a fallar. Es lo único que distingue ATDD de escribir tests después.
- Si `.jira/$1.md` no existe, corré `npm run jira:import` antes de nada.
- Si el ticket llega sin criterios de aceptación, **no los inventes**: acordalos con el usuario primero.
- Si `hornerito-domain-expert` devuelve `[NO CONFIRMADO]`, pará y preguntá. El default es preguntar, no ejecutar.
- Si la historia toca datos de organización, tiene que haber un escenario de aislamiento entre organizaciones.
- El commit lo pide el usuario, nunca vos.

Arrancá diciendo en una línea qué historia vas a trabajar y cuál es el primer paso.
