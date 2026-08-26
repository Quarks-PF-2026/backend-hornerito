---
name: adr
description: Use cuando haya que tomar o documentar una decisión arquitectónica, cuando el usuario pregunta si algo merece un ADR, o cuando hay que diagramar arquitectura o un flujo relevante. Do NOT use para cambios que siguen un patrón ya establecido en el repo.
---

# Decisiones arquitectónicas

Viven en `../lab-hornerito/adr/`. Las escribe `architecture-scribe`, que es el único autorizado a numerarlas. Criterio de fondo en `CLAUDE.md` §7.

## Qué merece un ADR

Una decisión **cara de revertir**, o que **un integrante podría cuestionar dentro de tres meses**:

- Elegir un patrón o una estrategia de persistencia
- Mover un límite entre módulos
- Sumar una dependencia
- Cambiar un contrato que otro repo consume
- Aceptar deliberadamente un trade-off incómodo

## Qué no

- Nombres de variables, archivos o endpoints
- Un endpoint que sigue el patrón que ya existe
- Un fix
- Una decisión que nadie discutiría

Un repositorio lleno de ADRs triviales es peor que ninguno: nadie los lee, y los tres que importaban se pierden entre los cuarenta que no.

## La regla que más se rompe

**Un ADR tiene que documentar la alternativa que se descartó y por qué.** Un ADR sin alternativas no es una decisión documentada: es una justificación escrita después de los hechos, y se nota.

Si no podés reconstruir qué alternativa real estuvo sobre la mesa, **preguntale al usuario** en vez de inventar una alternativa de paja para que la elegida gane por contraste. Ese es el fallo más común de los ADRs generados automáticamente.

## Antes de escribir

Consultá al usuario **antes** de tomar la decisión, no después de implementarla. El proyecto es de ingeniería: el valor está en que la decisión esté justificada y consensuada, no en que quede prolijamente documentada a posteriori.

## Ciclo de vida

Estados: `Propuesta` → `Aceptada` → (`Obsoleta` | `Reemplazada por ADR-NNN`).

**Un ADR Aceptado no se edita.** Si la decisión cambia, se escribe uno nuevo que lo reemplaza y el viejo cambia solo su estado. La historia de las decisiones es el producto acá, no el estado final — un tribunal quiere ver cómo se llegó, no solo dónde se llegó.

Numeración correlativa sin huecos. El índice está en `../lab-hornerito/adr/README.md`.

## Diagramas

En Mermaid, en `../lab-hornerito/diagramas/`. Siempre con contexto en prosa antes y una sección **Notas** con lo que el diagrama no muestra — un diagrama sin sus límites explícitos se lee como si fuera completo.

Tipos y cuándo: `C4Context`/`C4Container` para arquitectura, `sequenceDiagram` para flujos entre componentes, `erDiagram` para el modelo de datos, `stateDiagram-v2` para ciclos de vida, `flowchart` para procesos y decisiones.

Cuando un ADR cambia la arquitectura, verificá qué diagramas quedaron desactualizados. Un diagrama viejo miente con más autoridad que un texto viejo.
