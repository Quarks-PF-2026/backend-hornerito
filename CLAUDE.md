# CLAUDE.md — backend-hornerito

Este archivo tiene **precedencia máxima** y sobrescribe el flujo por defecto de skills y commands genéricos (`superpowers`, `/feature-dev`): esos describen CÓMO trabaja un agente *dentro* de una capa, no habilitan trabajo inline fuera del fast path (§1). Los skills de proceso (`brainstorming`, `writing-plans`, `systematic-debugging`) **no se disparan en fast path ni en tareas triviales** — se reservan para features nuevas grandes o debugging real. No metas ceremonia en cambios chicos.

**Stack**: NestJS 11 + TypeORM + PostgreSQL 17. Multi-tenancy por columna `organizationId` con Row-Level Security. Auth JWT. Node 22, TypeScript 5.7.

**Proyecto**: final de grado de ingeniería, 6 integrantes. El objetivo no es satisfacer a un cliente sino **demostrar y justificar decisiones de ingeniería**. Nada de parches ni soluciones temporales salvo pedido explícito del usuario. Tampoco sobre-ingeniería: KISS y YAGNI mandan. Ante una decisión arquitectónica real, se consulta al usuario y se documenta (§7).

---

## 1. Ruteo — una pregunta antes de tu primera acción

¿La tarea toca una **zona crítica**? → **DELEGÁ** al agente. Si no → **fast path** (editás vos).

| Zona crítica | Agente |
|---|---|
| Regla de negocio (antes de codificarla) | `hornerito-domain-expert` |
| Escenario de aceptación, `.feature`, `test/acceptance/` | `atdd-author` |
| `src/modules/tenant/`, RLS, `src/database/migrations/` | `tenancy-migration-expert` |
| `src/modules/auth/`, guards, estrategias, tokens | `nestjs-expert` |
| Implementación de una US (controllers, services, DTOs) | `nestjs-expert` |
| Contrato consumido por el frontend | `contract-checker` |
| Decisión arquitectónica, ADR, diagrama | `architecture-scribe` |
| Docs de conocimiento (§1, último párrafo) | `docs-keeper` |
| Cierre de tarea no trivial | `code-reviewer` |

**Fast path — editás inline, sin delegar:** leer, explorar y responder; corregir un typo o un mensaje de error; un `.md` que no sea doc de conocimiento; config de una línea evidente; agregar un campo a un DTO que ya existe sin tocar reglas.

**Regla de oro:** delegar protege las zonas donde un error filtra datos entre organizaciones, rompe la sesión o invalida un requisito. Fuera de ellas la fricción no aporta seguridad — editá directo. Ante duda de si una zona es crítica, tratala como crítica. La única edición directa de zona crítica permitida es aplicar textual un parche que un agente ya te devolvió.

**Docs de conocimiento — nunca inline.** `CLAUDE.md`, `DOMAIN.md`, `PROYECTO.md`, `.claude/AGENTS.md`, `.claude/agents/*.md`, `.claude/README.md` se editan **siempre** vía `docs-keeper`, aunque el cambio parezca de una línea. Es el único actor que deduplica y ubica sin repetir la misma regla en cuatro archivos.

**Paralelismo de agentes editores:** si dos o más agentes editan en paralelo con scopes que podrían solaparse, pasales `isolation: 'worktree'`. Con scopes disjuntos sin worktree, el prompt de cada uno debe decir "no toques archivos fuera de tu lista asignada". Al terminar corré `git status` y cruzalo contra lo que cada agente reportó.

---

## 2. Tests — el gate y por qué no podés correrlos

Tres niveles, **clasificados por path**. Ningún test se movió de lugar para estrenar la taxonomía:

| Nivel | Path | Comando | Qué prueba |
|---|---|---|---|
| Unit | `src/**/*.spec.ts` | `npm run test:unit` | Lógica de un componente con sus dependencias mockeadas |
| Integración | `test/**/*.e2e-spec.ts` | `npm run test:integration` | Persistencia real: migraciones, RLS, aislamiento entre organizaciones |
| Aceptación | `test/acceptance/*.steps.ts` | `npm run test:acceptance` | Que la user story se cumple, en Gherkin español |

**El orquestador no puede correr tests.** Un hook `PreToolUse` bloquea `npm run test*` y `npx jest` salvo que el comando lleve el token `HN_TEST_GATE`:

- `HN_TEST_GATE=agent` — lo usa el agente que implementó el cambio, al cerrar.
- `HN_TEST_GATE=reviewer` — lo usa `code-reviewer`.
- `HN_TEST_GATE=ci` — lo usa GitHub Actions.
- El orquestador **no tiene token**. Es a propósito: el output de 154 tests en el thread principal quema contexto para nada.

Si el usuario quiere ver la suite, que la corra él con `! npm run test:all`. **Nunca spawnees un agente solo para correr tests**, y nunca le sugieras un token al orquestador.

Los niveles de integración y aceptación necesitan la base efímera levantada:

```
npm run db:test:up
DATABASE_URL=postgresql://hornerito:hornerito@localhost:5433/hornerito_test
npm run db:test:down   # -v, se lleva todo
```

`test/acceptance/support/world.ts` **se niega a arrancar** si `DATABASE_URL` no apunta a una base terminada en `_test`. Los escenarios borran datos; la guarda existe para que nadie se lleve puesta su base de desarrollo.

---

## 3. ATDD — el ciclo, y el gate que lo hace real

El flujo completo está en la skill `atdd-cycle` y se dispara con `/us QK-NN`. Lo que no es negociable:

0. **Gate DoR.** Antes de arrancar cualquier otro paso, la historia traída de Jira tiene que cumplir la Definition of Ready que el equipo firmó. Si falla, el ciclo **no arranca**: se reporta qué falta y se acuerda con el equipo. Criterio verificable en `.claude/AGENTS.md` §Gates.
1. **El escenario se escribe antes que la implementación.** Lo escribe `atdd-author`, que tiene prohibido tocar `src/`.
2. **Gate RED.** Antes de implementar, la suite de aceptación **debe fallar**. Si pasa en verde con el código actual, el escenario no está probando nada y se rechaza — es el único control que distingue ATDD de escribir tests después.
3. **Gate GREEN**, que es la condición "probada" del **gate DoD** de cierre. El agente que implementa cierra con la aceptación en verde y sin regresión en los otros dos niveles, pero el DoD completo pide además implementada, integrada, documentada y **validada por el Product Owner** — esta última externa al ciclo, pendiente hasta la Sprint Review. Criterio completo en `.claude/AGENTS.md` §Gates.
4. Un `.feature` por user story, con la clave del ticket en el nombre: `test/acceptance/QK-26.feature`.

Gherkin en **español** (`# language: es`, `Característica` / `Escenario` / `Dado` / `Cuando` / `Entonces`). El `.feature` es un artefacto que alguien que no lee código tiene que poder revisar: escribilo en lenguaje de negocio, sin nombres de endpoint ni de tabla. Los detalles técnicos viven en el `.steps.ts`.

---

## 4. Convenciones

- **Idioma**: código e identificadores en inglés; comentarios, mensajes de error al usuario y valores de enum de negocio en español (`'Alimentos secos'`, `'coordinador'`).
- **Comentarios**: explican el *porqué* y el trade-off, no el qué. El repo ya tiene buenos ejemplos en `src/modules/tenant/tenant.interceptor.ts` y en la cabecera de `src/database/migrations/public/1786000000000-ColumnBasedTenancy.ts`. Sostené ese nivel.
- **Archivos**: kebab-case con sufijo de rol — `*.controller.ts`, `*.service.ts`, `*.module.ts`, `*.entity.ts`, `*.guard.ts`, DTOs en `dto/`. Migraciones: `<timestamp>-PascalCaseName.ts`.
- **SQL**: columnas en camelCase citado (`"organizationId"`). Constraints con prefijo explícito: `IDX_`, `UQ_`, `FK_`, `PK_`.
- **Entidades**: no declaran relaciones TypeORM (`@ManyToOne`/`@OneToMany`), solo columnas uuid. La integridad vive en las FKs de las migraciones. **Un `find` con `relations` falla** — no lo escribas.
- **Validación**: `class-validator` en los DTOs. El `ValidationPipe` global ya corre con `whitelist: true, transform: true`.
- Lint y formato: `npm run lint` (ESLint 9 flat + Prettier). No pelees con el formatter.

---

## 5. Explorar sin quemar tokens

Para localizar o entender código: MCP `codebase-memory` **primero** (`search_graph`, `trace_path`, `get_code_snippet`, `search_code`, `get_architecture`, `query_graph`). Read/Grep/Glob **solo** para el archivo puntual que vas a editar o para config no-código.

**No uses los agentes `Explore` / `general-purpose` ni Read/Grep masivo para "mapear el proyecto".** El grafo ya lo tiene. Los hooks de `SessionStart` gestionan su frescura y te inyectan qué hacer — seguí lo que dicen.

Otras palancas: `code-reviewer` y `hornerito-domain-expert` son de invocación **selectiva**, no de cada tarea (§10). Todo agente tiene un cap de output en su prompt: respetalo, no narres lo que leíste.

MCP relevantes acá: `codebase-memory` (código). Notion, Microsoft 365 y Azure DevOps están conectados a nivel global pero **no se usan en este proyecto** — no cargues sus tools.

---

## 6. Multi-tenancy — el patrón, en una pantalla

Detalle completo en `../lab-hornerito/adr/001-multi-tenancy-por-columna-con-rls.md`.

- Cada tabla del tenant tiene `organizationId` y una policy RLS `tenant_isolation` que compara contra `current_setting('app.current_org')`.
- `TenantGuard` valida que el JWT traiga `orgId`, que la organización exista y esté `validated`, y **relee la membresía en cada request** (para que una baja de rol aplique sin esperar a que expire el token).
- `TenantInterceptor` toma un `QueryRunner` dedicado, hace `SET ROLE "hornerito_app"` + `set_config('app.current_org', ...)`, lo cuelga en `request.tenantQueryRunner` y lo libera con `RESET ROLE`.
- Los servicios piden el manager a `TenantContextService.getManager()`, no a `@InjectRepository`.

**Doctrina, y es la regla que más se viola:** *RLS es la red de seguridad, no el filtro.* Todo servicio pasa `organizationId` explícito en cada query igual. Si escribís una query que depende de que el RLS la filtre, está mal aunque devuelva lo correcto.

---

## 7. Dominio y decisiones arquitectónicas

**Reglas de negocio → `DOMAIN.md`.** Es la fuente de verdad del negocio, no el código. Antes de codificar cualquier regla (transiciones de estado, validaciones de flujo, quién puede qué), consultá `hornerito-domain-expert`. **No deduzcas reglas leyendo el código**: el código puede estar implementando mal el requisito, y esa diferencia es exactamente lo que el proyecto tiene que documentar.

`DOMAIN.md` marca con `[NO CONFIRMADO]` toda regla que todavía no validó el equipo. Si tu tarea depende de una, **no la asumas**: escalá al usuario con `AskUserQuestion`. El default ante conflicto es preguntar, no ejecutar.

**Decisiones arquitectónicas → ADR.** Merece ADR toda decisión que sea cara de revertir o que un integrante podría cuestionar después: elección de patrón, límite entre módulos, estrategia de persistencia, dependencia nueva. No merece ADR: elegir un nombre de variable, agregar un endpoint que sigue el patrón existente. Ante duda, preguntá al usuario antes de decidir — no elijas por tu cuenta y documentes después.

Los ADR y diagramas viven en `../lab-hornerito/` y los escribe `architecture-scribe`. Diagramas en Mermaid, siempre acompañados de contexto en prosa.

---

## 8. Git flow

Integración `develop`, release `main`.

- **Nunca** merge, rebase ni cherry-pick entre ramas sin instrucción explícita. Al cerrar una tarea: "branch listo", punto. No ofrezcas merge.
- Se commitea **cuando el usuario lo pide**, nunca por iniciativa propia. Lo mismo para push y PR.
- Commits en Conventional Commits, en español, con el ticket al final: `feat(donaciones): registrar donaciones presenciales recibidas (QK-26)`.
- Sin `Co-Authored-By` ni firma de Claude.
- `../lab-hornerito` y cualquier repo secundario: nunca commitear sin aprobación explícita.

---

## 9. Tickets de Jira

El canal es el **MCP oficial de Atlassian** (`https://mcp.atlassian.com/v1/mcp/authv2`), configurado en `.mcp.json` en la raíz del backend. Cada integrante autentica por OAuth en el navegador la primera vez; no hay token que gestionar. Los permisos del MCP siguen a los del usuario autenticado — el agente solo puede lo que esa persona ya podía en Jira.

Site `https://quarksgrupo.atlassian.net`, cloudId `253d5eb4-6be1-4895-af92-31ec6e55a598`, proyecto `QK`. Detalle de campos, tools y estados del board en la skill `jira-ticket`.

Alcance concedido al agente: **leer la historia, cambiar su estado y asignarla a un usuario**. Nada de editar campos ni borrar.

El canal por export CSV (`npm run jira:import`) quedó obsoleto y fue retirado del repo; la dinámica y su fundamento quedaron archivados en `../lab-hornerito/archivo/jira-csv/`. Fundamento del cambio en ADR-004.

**Lo que no cambia**: el agente lee la historia que está trabajando, nunca el sprint entero. Si el ticket llega sin criterios de aceptación, el escenario no se puede derivar: no los inventes. Escalá al usuario para acordarlos. Detalle en la skill `jira-ticket`.

**Gates DoR y DoD** (entrada y cierre del ciclo ATDD): tabla y criterio para avanzar en `.claude/AGENTS.md` §Gates; procedimiento en la skill `atdd-cycle` y en §3 y §10 de este archivo.

---

## 10. Cierre de tarea

1. El agente que implementó dejó la aceptación en verde con su token (§2) — es la condición "probada" del gate DoD (§3, `.claude/AGENTS.md` §Gates).
2. ¿Hubo decisión arquitectónica? → `architecture-scribe` (§7).
3. ¿Zona crítica o lógica no trivial? → `code-reviewer`. UI de config, un `.md` o un cambio de una línea **no lo disparan**.
4. ¿Se descubrió una convención o un anti-patrón reusable? → `docs-keeper`.
5. Reportá qué quedó hecho y qué no. Si un test falla, decilo con el output. Si salteaste un paso, decilo.
6. Transicioná el ticket en Jira y dejá explícito que el DoD no cierra hasta que el Product Owner lo valide en la Sprint Review — esa quinta condición no la verifica el agente.
7. El commit lo pide el usuario (§8).

`CLAUDE.md` no almacena listas de tareas ni estado del proyecto — eso va en `PROYECTO.md`.
