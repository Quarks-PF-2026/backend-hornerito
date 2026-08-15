---
name: jira-ticket
description: Use cuando haya que importar, leer o interpretar un ticket QK-NN de Jira, cuando el usuario menciona un número de ticket, o cuando falta información en un ticket para poder trabajarlo. Do NOT use para tareas sin ticket asociado.
---

# Tickets de Jira en Hornerito

El canal es el **MCP oficial de Atlassian**, configurado en `.mcp.json` en la raíz del backend. Detalle del canal y del alcance de permisos en `CLAUDE.md` §9 — no lo repitas acá.

## Leer el ticket

Pedile al MCP la historia puntual que vas a trabajar, nunca el sprint entero — es la misma regla que regía con el CSV normalizado, y sigue siendo la razón por la que no se carga todo el board.

`[A CONFIRMAR tras autenticar el MCP]`: nombre exacto de la tool de lectura y la forma en que devuelve descripción, criterios de aceptación, estimación, sprint e impedimentos.

## Gate DoR — antes de arrancar el ciclo

El ciclo `atdd-cycle` no arranca sin que la historia pase la Definition of Ready. Verificá sobre el ticket:

1. Descripción no vacía
2. Criterios de aceptación presentes
3. Estimación en story points cargada
4. Asignada al sprint activo
5. Sin impedimentos declarados

Si falla alguno, **el ciclo se detiene acá**: reportá exactamente qué falta y acordalo con el equipo antes de seguir. Detalle del gate y su criterio de avance en `.claude/AGENTS.md` §Gates.

**Si lo que falta son los criterios de aceptación, no los inventes.** Un escenario derivado de criterios inventados valida una historia que nadie pidió, y en un proyecto cuyo objetivo es demostrar trazabilidad eso es peor que no tener el escenario. Escalá al usuario con `AskUserQuestion`, proponiendo un borrador en Dado/Cuando/Entonces para que confirme o corrija, y con la confirmación actualizá el ticket en Jira mismo (no un archivo local: no hay derivado que lo sostenga).

## Cambiar estado y asignar

El agente puede transicionar el ticket y asignarlo a un usuario — nada más (`CLAUDE.md` §9). Usalo al cerrar el ciclo (gate DoD, `.claude/AGENTS.md` §Gates): la transición se hace explícita dejando dicho que la validación del Product Owner queda pendiente hasta la Sprint Review.

`[A CONFIRMAR tras autenticar el MCP]`: nombres reales de los estados del board (para saber a qué estado transicionar en cada paso del ciclo).

## Trazabilidad

La misma clave se repite en tres lugares (`DOMAIN.md` §13):

```
QK-26 en Jira                    el requisito
test/acceptance/QK-26.feature    la verificación
feat(donaciones): ... (QK-26)    el cambio
```

Si los tres no coinciden, la trazabilidad está rota y el tomo no cierra.

## Plantilla de user story

Para escribir tickets nuevos que se traduzcan bien a Gherkin: `../lab-hornerito/templates/user-story.md`. Sus criterios ya vienen en formato Dado/Cuando/Entonces, que es lo que hace que el paso a `.feature` sea mecánico en vez de interpretativo.

## Trazabilidad

La misma clave se repite en tres lugares (`DOMAIN.md` §13):

```
.jira/QK-26.md                  el requisito
test/acceptance/QK-26.feature   la verificación
feat(donaciones): ... (QK-26)   el cambio
```

Si los tres no coinciden, la trazabilidad está rota y el tomo no cierra.

## Plantilla de user story

Para escribir tickets nuevos que se traduzcan bien a Gherkin: `../lab-hornerito/templates/user-story.md`. Sus criterios ya vienen en formato Dado/Cuando/Entonces, que es lo que hace que el paso a `.feature` sea mecánico en vez de interpretativo.
