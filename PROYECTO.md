# PROYECTO.md — estado de Hornerito

> ## [A REVISAR — NO VALIDADO POR EL EQUIPO]
>
> Contenido generado con asistencia de IA el 2026-08-15, inferido del código y de
> la sesión de configuración del stack. **Nadie del equipo lo revisó.** Puede
> contener afirmaciones incorrectas, alternativas que nunca estuvieron sobre la
> mesa y reglas que nadie acordó.
>
> No lo cites en el tomo ni lo uses como fuente de verdad. Cuando alguien lo
> valide, que corrija lo que haga falta y **borre este bloque**.

---


**Este documento lo mantiene el equipo, no solo los agentes.** Si algo acá está desactualizado, corregilo. Si tomaste una decisión que no figura, agregala.

Qué va acá: estado real, deuda técnica conocida, decisiones pendientes, y quién está haciendo qué.
Qué **no** va acá: reglas de trabajo (`CLAUDE.md`), reglas de negocio (`DOMAIN.md`), decisiones ya tomadas y justificadas (`../lab-hornerito/adr/`).

Última actualización: 2026-08-15

---

## 1. Estado por componente

| Componente | Estado | Notas |
|---|---|---|
| Backend NestJS | En desarrollo | 11 entidades, 13 grupos de endpoints |
| Multi-tenancy (columna + RLS) | Implementado | Migrado desde schema-per-tenant. Ver ADR-001 |
| Auth (registro, verificación, login, recuperación) | Implementado | |
| Organizaciones y membresías | Implementado | Validación por admin de plataforma |
| Insumos, necesidades, publicaciones, puntos | Implementado | ABM completo |
| Donaciones presenciales | Implementado | QK-26 |
| Directorio público | Implementado | |
| Frontend Angular + Ionic | En desarrollo | Todas las pantallas del backend cubiertas |
| Tests backend | 116 unit + 38 integración | Sin escenarios de aceptación todavía |
| Tests frontend | 17 | 0 de componentes |
| CI | Recién incorporado | Aceptación no bloqueante en esta iteración |
| Documentación de arquitectura | Recién incorporada | `../lab-hornerito/` |

## 2. Sprint actual

`[A COMPLETAR POR EL EQUIPO]` — qué historias están en curso y quién las tiene.

| Historia | Responsable | Estado |
|---|---|---|
| | | |

## 3. Deuda técnica conocida

Ordenada por lo que más duele. Cada entrada dice **por qué existe**, no solo qué falta — sin eso nadie puede decidir si vale la pena pagarla.

| # | Deuda | Por qué existe | Impacto |
|---|---|---|---|
| 1 | Las historias ya implementadas (QK-12, 13, 15, 17, 26) no tienen escenario de aceptación | ATDD se adoptó después de que se implementaran. Tienen tests de trazabilidad en `test/sprint2/`, que no son lo mismo | No hay verificación en lenguaje de negocio de lo ya construido. Es lo que impide volver el job de aceptación bloqueante en CI |
| 2 | El frontend no tiene tests de componentes | Nunca se escribieron | Cualquier refactor de UI es a ciegas |
| 3 | El `README.md` del backend es el boilerplate de NestJS | Nunca se reemplazó | Un integrante nuevo no tiene onboarding escrito del proyecto real |
| 4 | `nginx.conf` del frontend no proxya `/api` | El deploy real es Vercel, que sí lo hace por `vercel.json`. La ruta Docker quedó a medias | El build de producción vía Docker apunta a `/api` sin destino. Solo funciona por Vercel |
| 5 | `tsconfig.json` del frontend sin `"strict": true` | Default del CLI, nunca se ajustó | Se pierden errores de tipo que el compilador podría atrapar |
| 6 | El frontend no tiene ESLint | Nunca se configuró | Solo Prettier: se formatea pero no se detectan anti-patrones |
| 7 | No hay coverage con umbral | `test:cov` existe pero sin `coverageThreshold` ni gate | La cobertura puede bajar sin que nadie se entere |
| 8 | Las entidades no declaran relaciones TypeORM | Decisión implícita, nunca documentada | Un `find` con `relations` falla en runtime. Es la trampa que más rápido encuentra alguien nuevo |
| 9 | `lab-hornerito` no está en GitHub | Se creó local en esta iteración | **Los otros 5 integrantes no lo tienen.** Los ADRs y el catálogo de skills no se comparten |
| 10 | 15 errores de ESLint preexistentes en el backend | `npm run lint` corre con `--fix`, así que nunca se vieron: los arregla en el working tree de quien lo corre y siguen en el repo | El job de lint del CI está en `continue-on-error` por esto. Detalle: `no-unsafe-*` en los decoradores de auth y en `tenant.guard.ts`, `require-await` en cuatro `.spec.ts`, un `no-unused-vars` en `qk-15-users.e2e-spec.ts`, un `no-unnecessary-type-assertion` en `test/sprint2/helpers.ts` |

## 4. Decisiones pendientes

Nadie debería implementar sobre estas sin resolverlas primero.

| # | Decisión | Bloquea |
|---|---|---|
| 1 | Las 8 preguntas abiertas de `DOMAIN.md` §15 | Toda historia que toque una regla marcada `[A DEFINIR]` |
| 2 | Alcance exacto de "necesidad como plantilla reutilizable" | Cualquier trabajo sobre necesidades |
| 3 | ¿Se sube `lab-hornerito` a GitHub? ¿Como repo propio o submódulo? | Deuda 9 |
| 4 | ¿El job de aceptación en CI pasa a bloqueante y cuándo? | Depende de la deuda 1 |

### Confirmadas en la encuesta del 2026-08-15

Estas ya no son decisiones pendientes, son **trabajo pendiente** — el negocio las
definió y el código todavía no las refleja. Detalle en `DOMAIN.md` §12 y §13.

| Decisión | Qué implica |
|---|---|
| Catálogo de insumos: base global + propios por organización | Migración. Hoy es enteramente por organización |
| Donación con patrón State | Decisión de diseño tomada, implementación diferida. Necesita ADR |
| Ramas por funcionalidad con nombre conceptual (`necesidad`, `organizacion`, …) | Una rama junta varias historias: el gate de aceptación en el PR verifica un conjunto, no una historia sola |
| Difusión pública y gestión interna pesan igual | Ninguna se puede recortar sin justificar |
| No hace falta aprobación de PR: cada uno mergea lo suyo | **Sin aprobación obligatoria el CI informa pero no bloquea.** Es lo primero que hay que cambiar si se quiere que ATDD sea un gate y no una convención |
| Imágenes también en publicaciones e insumos | Hoy la media polimórfica solo se usa para organización |
| Traza de quién y por qué en el ajuste manual de cobertura | Hoy el ajuste se permite sin dejar rastro |
| Donante con o sin cuenta | Hoy el código solo soporta la variante sin cuenta |

## 5. Puesta en marcha del workflow — PENDIENTE

**El stack está instalado pero NO está operativo.** Lo que sigue es lo que falta para poder correr `/us QK-NN` de verdad. Está ordenado: primero lo que bloquea, después lo que mejora.

### 5.1 Bloqueante — sin esto el ciclo no corre

| # | Qué | Por qué | Cómo verificar que quedó |
|---|---|---|---|
| 1 | **Reiniciar la sesión de Claude Code** | Los hooks y `settings.json` se cargan al arrancar. En la sesión donde se instalaron no están activos | Pedir `npm run test:unit` sin token: tiene que bloquearse con la explicación del gate |
| 2 | **Indexar el grafo de código** | `CLAUDE.md` §5 obliga a explorar con `codebase-memory` antes que con Read/Grep, pero el repo no está indexado. Sin esto, cada agente cae al modo caro | Al abrir sesión, el hook deja de pedir el índice. Corre una vez: `index_repository` con `mode='full'`, `persistence=true` |
| 3 | **Autenticar el MCP de Atlassian en cada máquina** | El canal pasó de export CSV a MCP (2026-08-15, ver `CLAUDE.md` §9 y ADR-004); cada integrante tiene que autenticar por OAuth la primera vez para que el agente pueda leer historias | El agente lee una historia real del board sin error de autenticación |
| 4 | **Descubrir los nombres reales de los estados del board de Jira** | Hace falta para poder configurar a qué estado transiciona el ciclo en cada paso (gate DoD). No se puede saber hasta que el MCP esté autenticado | `[A CONFIRMAR tras autenticar el MCP]` en la skill `jira-ticket` reemplazado por los nombres reales |

### 5.2 Bloqueante para que ATDD sea un gate y no una convención

| # | Qué | Por qué |
|---|---|---|
| 5 | **Correr `/us` end-to-end con una historia real** | El harness está probado (smoke verde, gate de tests verificado) pero **el ciclo completo nunca se ejecutó**. Es la única forma de saber si los nueve agentes se encadenan bien |
| 6 | **Escribir escenarios para las historias ya implementadas** | Deuda 1. Mientras falten, el job de aceptación en CI está en `continue-on-error` y no bloquea nada |
| 7 | **Decidir si el CI pasa a bloqueante** | Hoy informa. Sin aprobación obligatoria de PR (§4), nadie mira el resultado antes de mergear salvo el autor. Requiere marcar los checks como *required* en la configuración del repo en GitHub |
| 8 | **Saldar los 15 errores de ESLint** | Deuda 10. Hasta entonces el job de lint tampoco bloquea |

### 5.3 Bloqueante para el resto del equipo

| # | Qué | Por qué |
|---|---|---|
| 9 | **Decidir el destino de `lab-hornerito`** | Es repo local sin remoto. Los otros 5 no lo tienen: no ven ADRs, plantillas ni catálogo, y el hook de skills les sale mudo. Decidir si va a GitHub como repo propio o como submódulo (decisión 3) |
| 10 | **Que cada integrante instale lo del catálogo** | El hook avisa al arrancar, pero solo si tiene `lab-hornerito` clonado al lado. Depende del punto 9 |
| 11 | **Onboarding del equipo** | `.claude/README.md` explica el stack, pero nadie lo leyó todavía. En particular hay que avisar que **no van a poder correr los tests desde el chat** y que eso es deliberado |

### 5.4 Validación de lo generado — antes de usarlo en el tomo

| # | Qué | Estado |
|---|---|---|
| 12 | **Revisar los 11 documentos marcados `[A REVISAR]`** | 3 ADRs, 5 diagramas, `convenciones.md`, `skills-catalogo.md` y este archivo. Los generó una IA y nadie los validó. **No citarlos en el tomo hasta que alguien borre el bloque de advertencia** |
| 13 | **Responder las 8 preguntas abiertas de `DOMAIN.md` §15** | Mientras sigan abiertas, `hornerito-domain-expert` pregunta en vez de asumir, y cualquier historia que las toque se frena |
| 14 | **Relevar con el equipo si hay más reglas acordadas sin implementar** | `DOMAIN.md` §12 tiene 6; nadie confirmó que sean todas |
| 15 | **Escribir el ADR del patrón State para donaciones** | La decisión está tomada y documentada en `DOMAIN.md` §7, pero sin ADR. No se escribió para no sumar otro artefacto sin validar |

### 5.5 Trabajo de producto que la encuesta destapó

Las 7 discrepancias de `DOMAIN.md` §13 son trabajo real, no documentación. En orden de impacto sobre el modelo de datos: catálogo de insumos base global, necesidad como plantilla + publicación, donación con patrón State, traza en el ajuste manual de cobertura, imágenes en publicaciones e insumos, donante con cuenta.

Ninguna se empieza sin cerrar antes su pregunta abierta correspondiente.

## 6. Convenciones del equipo

Las de código y trabajo están en `CLAUDE.md` §4 y §8. Las del equipo (commits, ramas, quién aprueba) en `../lab-hornerito/equipo/convenciones.md`, con lo no acordado marcado `[A DEFINIR]`.

## 7. Cómo levantar el proyecto

```
# Backend
docker compose up -d              # API en :3000, Postgres en :5432
npm run start:dev                 # o sin Docker, con DATABASE_URL apuntada

# Tests
npm run test:unit
npm run db:test:up                # Postgres efímero en :5433
npm run test:integration
npm run test:acceptance
npm run db:test:down

# Tickets
# vía MCP de Atlassian, autenticado por OAuth (CLAUDE.md §9)
```

Las migraciones corren solas al bootstrapear (`migrationsRun: true`).

## 8. Dónde está cada cosa

| Busco | Está en |
|---|---|
| Qué pide la cátedra y qué hay que corregir | `../lab-hornerito/catedra/HALLAZGOS-2026-08-15.md` |
| Documentación de cátedra en crudo | `../lab-hornerito/catedra/base 15-08-2026/` |
| Cómo trabajar en este repo | `CLAUDE.md` |
| Qué dice el negocio | `DOMAIN.md` |
| Qué agente usar y cuándo | `.claude/AGENTS.md` |
| Cómo se desarrolla una historia | `.claude/skills/atdd-cycle/SKILL.md` |
| Por qué se decidió algo | `../lab-hornerito/adr/` |
| Diagramas | `../lab-hornerito/diagramas/` |
| Qué skills usa el equipo | `../lab-hornerito/equipo/skills-catalogo.md` |
| Plantillas de US, DoD, ADR | `../lab-hornerito/templates/` |
| Convenciones del frontend | `../frontend-hornerito/CLAUDE.md` y `DESIGN_SYSTEM.md` |
