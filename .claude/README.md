# `.claude/` — cómo trabaja el equipo con Claude Code acá

Onboarding. Si es tu primera sesión en este repo, leé esto y después `CLAUDE.md`.

## Qué hay acá

```
.claude/
  settings.json     permisos y hooks. Versionado: aplica a los 6
  AGENTS.md         quién es cada agente, workflows y gates
  agents/           9 agentes especializados
  skills/           3 skills propias del proyecto
  commands/         3 slash commands
  hooks/            4 scripts Node que corren solos
```

Fuera de `.claude/`, la capa de conocimiento: `CLAUDE.md` (cómo trabajar), `DOMAIN.md` (qué dice el negocio), `PROYECTO.md` (estado y deuda).

## Lo primero que tenés que entender

**Antes de tu primera acción, una pregunta: ¿la tarea toca una zona crítica?**

Si sí, delegás al agente que corresponde. Si no, editás vos directo (fast path). La tabla completa está en `CLAUDE.md` §1.

No es burocracia: delegar protege las zonas donde un error filtra datos entre organizaciones o rompe la sesión de alguien. Fuera de esas zonas, la fricción no aporta nada — editá directo y listo.

## Los 9 agentes, en una línea cada uno

| Agente | Para qué |
|---|---|
| `hornerito-domain-expert` | ¿Qué dice el negocio? Se consulta **antes** de codificar una regla |
| `atdd-author` | Escribe los escenarios de aceptación. No toca `src/` |
| `nestjs-expert` | Implementa |
| `tenancy-migration-expert` | Migraciones, RLS, aislamiento entre organizaciones |
| `code-reviewer` | Revisa antes de cerrar. Corre la suite primero |
| `contract-checker` | ¿El front y el back siguen hablando el mismo idioma? |
| `architecture-scribe` | Escribe los ADRs y los diagramas |
| `docs-keeper` | Único que edita la capa de conocimiento |
| `skills-auditor` | Catálogo de skills del equipo. Solo si lo pedís |

Se invocan solos por el `description` de cada uno, o a mano con `@nombre-del-agente`.

## Los 3 comandos

```
/us QK-26          desarrolla una user story completa con el ciclo ATDD
/adr <título>      documenta una decisión arquitectónica
/skills-audit      actualiza el catálogo de skills del equipo
```

## Por qué no podés correr los tests

Vas a intentar `npm run test` y un hook te lo va a bloquear. **Es a propósito.**

El output de 154 tests en el thread principal quema contexto para nada. Los tests los corre el subagente que implementó el cambio, con su token: `HN_TEST_GATE=agent npm run test:acceptance`.

Si querés ver la suite vos mismo, corréla con el prefijo `!` desde el prompt:

```
! npm run test:all
```

Eso la ejecuta en tu terminal, no en el contexto del modelo.

## Los 4 hooks

Corren solos, en Node (multiplataforma — el equipo tiene SO mixto). **Todos son fail-open**: si uno se rompe, sale silencioso y no traba tu sesión.

| Cuándo | Qué hace |
|---|---|
| Al abrir sesión | Chequea la frescura del grafo de código y te dice si hay que reindexar |
| Al abrir sesión | Avisa si te falta alguna skill del catálogo del equipo. Silencioso si está todo |
| Antes de un comando | Bloquea la suite de tests en el thread principal (arriba) |
| Al cerrar el turno | Si tocaste una zona crítica, te recuerda el gate que corresponde |

El segundo necesita `../lab-hornerito` clonado. Si no lo tenés, sale mudo — no es un error.

## Por qué no hay skills externas instaladas

Política explícita: las skills genéricas de proceso (`superpowers` y compañía) son caras y empujan a meter ceremonia en tareas chicas. Las 3 skills de acá son propias, cortas y específicas del proyecto.

Si tenés skills instaladas a nivel usuario, está bien — anotalas en el catálogo con `/skills-audit` para que el resto sepa qué existe.

## Antes de tu primer commit

Leé `CLAUDE.md` §8. Lo importante: los commits los pedís vos, el agente nunca commitea por iniciativa propia, y van en Conventional Commits en español con el ticket al final.

## Si algo de acá está mal

No lo edites a mano: pedíselo a `docs-keeper`. Es el único que deduplica y ubica sin terminar con la misma regla escrita en cuatro archivos.
