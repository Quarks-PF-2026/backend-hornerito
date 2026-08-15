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

## 5. Convenciones del equipo

Las de código y trabajo están en `CLAUDE.md` §4 y §8. Las del equipo (commits, ramas, quién aprueba) en `../lab-hornerito/equipo/convenciones.md`, con lo no acordado marcado `[A DEFINIR]`.

## 6. Cómo levantar el proyecto

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
npm run jira:import               # CSV en .jira/raw/ → .jira/QK-NN.md
```

Las migraciones corren solas al bootstrapear (`migrationsRun: true`).

## 7. Dónde está cada cosa

| Busco | Está en |
|---|---|
| Cómo trabajar en este repo | `CLAUDE.md` |
| Qué dice el negocio | `DOMAIN.md` |
| Qué agente usar y cuándo | `.claude/AGENTS.md` |
| Cómo se desarrolla una historia | `.claude/skills/atdd-cycle/SKILL.md` |
| Por qué se decidió algo | `../lab-hornerito/adr/` |
| Diagramas | `../lab-hornerito/diagramas/` |
| Qué skills usa el equipo | `../lab-hornerito/equipo/skills-catalogo.md` |
| Plantillas de US, DoD, ADR | `../lab-hornerito/templates/` |
| Convenciones del frontend | `../frontend-hornerito/CLAUDE.md` y `DESIGN_SYSTEM.md` |
