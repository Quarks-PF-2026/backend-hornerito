---
description: Inventaría las skills y plugins de Claude Code instalados y actualiza el catálogo del equipo
---

Delegá a `skills-auditor` para actualizar `../lab-hornerito/equipo/skills-catalogo.md`.

Contexto de por qué esto es manual y no automático: el chequeo del día a día lo hace el hook `check-team-skills.mjs`, que solo lee archivos y no cuesta tokens. Este comando es el inventario completo, y se corre cuando alguien instala algo nuevo o cuando el equipo revisa qué está usando cada uno.

Dos límites del agente que conviene tener presentes:

- **No instala ni desinstala nada.** Eso es decisión de cada integrante.
- **No promueve nada a `## Requeridas` por su cuenta.** Lo propone; el equipo decide. Ese heading es el que parsea el hook, así que agregar algo ahí le empieza a aparecer como faltante a los otros cinco.
