# AGENTS.md — roster, workflows y gates

Reglas de trabajo y ruteo: `CLAUDE.md` §1. Acá va solo lo que no cabe ahí: quién es quién, en qué orden se encadenan, y qué tiene que pasar para avanzar de un paso al siguiente.

## Roster

| Agente | Modelo | Lane | Escribe |
|---|---|---|---|
| `hornerito-domain-expert` | opus | Reglas de negocio. Gate **previo** | `DOMAIN.md` (solo con OK del usuario) |
| `atdd-author` | sonnet | Escenarios de aceptación | `test/acceptance/**` |
| `nestjs-expert` | sonnet | Implementación | `src/modules/**` (salvo `tenant/`), tests unit e integración |
| `tenancy-migration-expert` | opus | Aislamiento entre organizaciones | `src/database/migrations/**`, `src/modules/tenant/**` |
| `code-reviewer` | sonnet | Gate de cierre | nada (read-only) |
| `contract-checker` | sonnet | Contrato backend ↔ frontend | nada (read-only) |
| `architecture-scribe` | opus | ADRs y diagramas | `../lab-hornerito/adr/**`, `../lab-hornerito/diagramas/**` |
| `docs-keeper` | sonnet | Capa de conocimiento | `CLAUDE.md`, `PROYECTO.md`, `.claude/**` |
| `skills-auditor` | sonnet | Catálogo de skills del equipo | `../lab-hornerito/equipo/skills-catalogo.md` |

**Disciplina de lane**: cada agente edita solo su área. Si necesita otra, la flaggea al orquestador en lugar de invadirla. Los editores heredan todas las tools — la disciplina está en su system prompt, no en el campo `tools`. Los read-only sí la tienen restringida.

**Los agentes nunca se llaman entre sí.** Todo handoff vuelve al orquestador, que decide el siguiente paso. Es hub-and-spoke, no una cadena: así el orquestador puede cortar, reordenar o preguntarle al usuario en cualquier punto.

## Workflows

Notación: `→` secuencial, `∥` paralelo.

- **User story completa** (`/us QK-NN`):
  `jira-import` → `hornerito-domain-expert` → `atdd-author` (deja RED) → [`tenancy-migration-expert` si toca esquema →] `nestjs-expert` (deja GREEN) → [`architecture-scribe` si hubo decisión →] `code-reviewer`

- **Cambio que toca el contrato con el frontend**:
  `nestjs-expert` ∥ `contract-checker` (reporta qué rompe en el front) → el orquestador lleva el reporte a la sesión del frontend. El backend **no** edita el frontend.

- **Migración o cambio de RLS**:
  `hornerito-domain-expert` (si hay regla de negocio detrás) → `tenancy-migration-expert` → `architecture-scribe` (casi siempre hay ADR acá) → `code-reviewer`

- **Bug**:
  reproducirlo primero como escenario de aceptación con `atdd-author` → `nestjs-expert` lo arregla → el escenario queda como regresión permanente. Un bug sin escenario vuelve.

- **Se descubrió una convención o un anti-patrón reusable**:
  `docs-keeper`, siempre. Nunca inline (CLAUDE.md §1).

## Gates

| Gate | Cuándo | Criterio para avanzar |
|---|---|---|
| **Dominio** (previo) | Antes de codificar cualquier regla de negocio | `VEREDICTO: consistente`. Si `[VIOLA REGLA]` no se implementa. Si `[NO CONFIRMADO]`, se escala al usuario: el default es **preguntar, no ejecutar** |
| **RED** | Después de escribir el escenario, antes de implementar | La suite de aceptación **falla**. Si pasa en verde, el escenario no prueba nada y se rechaza (CLAUDE.md §3) |
| **GREEN** | Al cerrar el agente que implementó | `HN_TEST_GATE=agent npm run test:acceptance` verde y `test:unit` sin regresión. No delegable |
| **Base limpia** | Toda migración | `db:test:down && db:test:up` y después integración en verde. Una migración que solo corre sobre tu base actual no está probada |
| **Contrato** | Cambio en controllers o DTOs que el front consume | `CONTRACT REPORT` sin `[DIVERGENCE]` |
| **Review** | Zona crítica o lógica no trivial | `SUMMARY: ship`. Un `.md`, una config de una línea o un cambio trivial **no lo disparan** |
| **Documentación** | Cualquier cambio en la capa de conocimiento | Pasa por `docs-keeper`, que verifica que no exista ya en otro archivo |
| **Aislamiento** | Dos o más agentes editores en paralelo | `isolation: 'worktree'` o scopes disjuntos declarados, y `git status` cruzado al final |
| **Base única** | `nestjs-expert` y `tenancy-migration-expert` a la vez | **No se paralelizan.** Los dos corren `test:integration` contra la misma base efímera y se pisan los datos. Un worktree separado no alcanza: la base es una sola. Corrélos en secuencia |
| **Humano** | commit, push, PR, migración destructiva | OK explícito del usuario (CLAUDE.md §8) |

## Por qué no hay agente orquestador

El orquestador es el thread principal. Delegar la orquestación a un subagente agregaría un salto de contexto sin ganar nada: el subagente tendría que recibir todo el estado de la conversación, y el usuario perdería la posibilidad de intervenir entre pasos.

Lo que sí se hace es **restringir al thread principal por permisos y hooks**: no puede correr la suite (CLAUDE.md §2), no puede editar docs de conocimiento (§1), y no commitea sin que se lo pidan (§8). Las restricciones viven en `settings.json` y en los hooks, no en la buena voluntad del modelo.
