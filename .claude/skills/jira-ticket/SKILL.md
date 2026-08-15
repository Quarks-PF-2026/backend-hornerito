---
name: jira-ticket
description: Use cuando haya que importar, leer o interpretar un ticket QK-NN de Jira, cuando el usuario menciona un número de ticket, o cuando falta información en un ticket para poder trabajarlo. Do NOT use para tareas sin ticket asociado.
---

# Tickets de Jira en Hornerito

Los tickets entran por **export CSV**, no por API: así funciona para los 6 integrantes sin que nadie configure credenciales ni tokens.

## Importar

El dev exporta desde Jira (issue, sprint o filtro) y guarda el CSV en `.jira/raw/`. Después:

```
npm run jira:import                    # toma el CSV más reciente de .jira/raw/
npm run jira:import -- ruta/al.csv     # o uno puntual
```

Genera un `.md` normalizado por ticket: `.jira/QK-26.md`, de unas 40 líneas.

**Leé el `.md` del ticket que estás trabajando. Nunca el CSV crudo ni el sprint entero** — es la diferencia entre cargar 40 líneas y cargar varios miles.

## Por qué CSV y no la API

CSV es el más compacto de los formatos que Jira exporta (CSV, XML, HTML, Word, RSS): los otros triplican los bytes para la misma información. Pero ningún formato crudo se lee bien desde un agente, porque siempre trae el sprint completo. Por eso el paso de normalización: se parsea una vez y el agente lee solo lo suyo.

`.jira/` está en `.gitignore`. Es un derivado; Jira es la fuente de verdad y el archivo quedaría desactualizado al día siguiente. Regenerarlo es un comando.

## Qué contiene el `.md` normalizado

Frontmatter con clave, tipo, estado, responsable, sprint, puntos y épica; después descripción, criterios de aceptación, etiquetas y comentarios.

## Si faltan los criterios de aceptación

El importador lo avisa explícitamente al terminar. Cuando pasa:

1. **No los inventes.** Un escenario derivado de criterios inventados valida una historia que nadie pidió, y en un proyecto cuyo objetivo es demostrar trazabilidad eso es peor que no tener el escenario.
2. Escalá al usuario con `AskUserQuestion`, proponiendo un borrador de criterios en Dado/Cuando/Entonces para que confirme o corrija.
3. Con la confirmación, actualizá el ticket en Jira — no solo el `.md` local, que se regenera y pierde el cambio.

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
