---
description: Documenta una decisión arquitectónica como ADR en lab-hornerito (uso: /adr elección de motor de búsqueda)
argument-hint: <título de la decisión>
---

Documentá la decisión arquitectónica: **$ARGUMENTS**

Invocá la skill `adr` y después delegá a `architecture-scribe`.

Antes de delegar, verificá dos cosas:

1. **¿Esto merece un ADR?** Si es una decisión que nadie discutiría o que sigue un patrón ya establecido en el repo, decilo y no escribas nada. Un repositorio de ADRs triviales es peor que ninguno.
2. **¿La decisión ya se tomó, o se está tomando ahora?** Si todavía no se tomó, el ADR no es el primer paso: presentale al usuario las alternativas con sus trade-offs y tu recomendación, y recién con su respuesta se escribe el ADR. El proyecto es de ingeniería; el valor está en que la decisión esté justificada y consensuada, no en documentarla prolijamente después de los hechos.

Si no podés reconstruir qué alternativa real se descartó y por qué, preguntale al usuario en vez de inventar una alternativa de paja.
