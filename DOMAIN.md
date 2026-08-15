# DOMAIN.md — Dominio de negocio de Hornerito

> ## [PARCIALMENTE VALIDADO — encuesta del 2026-08-15, 4 rondas]
>
> **[CONFIRMADO]** lo respondió el líder técnico y vale como regla.
> **[PROVISORIO]** se confirmó "por ahora", pero el equipo puede cambiarlo.
> **[A DEFINIR]** no se acordó: ningún agente implementa sobre eso sin preguntar.
> Lo que no lleva marca proviene de leer el código y describe **lo que el sistema
> hace hoy**, no necesariamente lo que el negocio pidió.
>
> Queda pendiente relevar con el equipo completo (§14).

---

**Para qué sirve.** Describe *qué* hace Hornerito y *por qué*, no *cómo* está implementado. Lo técnico vive en `CLAUDE.md` y en los agentes. Cuando una regla y el código entran en conflicto, este documento gana en lo conceptual y la diferencia se registra en §12.

Mantenido junto con el agente `hornerito-domain-expert`.

---

## 0. Esencia del sistema

- **[CONFIRMADO]** Hornerito resuelve **dos problemas con el mismo peso**, y ninguno es secundario:
  1. **Difusión** — que un donante encuentre a quién donar, qué necesita y dónde llevarlo.
  2. **Gestión interna** — que la organización deje de llevar sus insumos y donaciones en papel o Excel y sepa qué le falta.

  Que pesen igual tiene una consecuencia de diseño: ninguna cara se puede recortar sin romper la propuesta. Una decisión que optimice una a costa de la otra necesita justificarse.
- El sistema es **multi-organización**: cada una ve y administra únicamente sus datos. El aislamiento es un requisito de confianza, no una preferencia.
- Dos planos de autoridad que no se mezclan: quién manda **en la plataforma** y quién manda **dentro de una organización**.

## 1. Qué es Hornerito

Plataforma web donde organizaciones sociales (comedores, merenderos, ONGs) publican qué necesitan y dónde recibirlo, registran lo que reciben, y difunden su actividad. En paralelo, un **directorio público** que cualquiera consulta sin cuenta.

## 2. Glosario

| Término | Definición de negocio |
|---|---|
| **Organización** | Entidad social que usa la plataforma. Unidad de aislamiento: todo dato pertenece a una y solo una. |
| **Insumo** (*supply*) | Tipo de bien que puede donarse, con categoría (alimentos secos, frescos, limpieza, higiene, bebidas). |
| **Plantilla de necesidad** | Definición reutilizable de algo que la organización suele necesitar. **[A DEFINIR]** su alcance exacto (§6). |
| **Necesidad publicada** | Instancia concreta de una plantilla, con cantidad requerida y cobertura. Es lo que el donante ve. |
| **Donación** | Registro de un aporte. Agrupa uno o más ítems. |
| **Ítem de donación** | Línea de la donación: qué insumo, cuánto, y opcionalmente contra qué necesidad se imputa. |
| **Punto de recolección** | Lugar físico donde la organización recibe donaciones, con horarios y ubicación. |
| **Publicación** (*post*) | Novedad que la organización difunde. |
| **Membresía** | Vínculo entre una persona y una organización, con un rol. |
| **Invitación** | Token con vencimiento por el cual una organización suma a alguien. |

## 3. Actores y roles

### Plano de plataforma

| Actor | Puede |
|---|---|
| Administrador de plataforma | Validar y rechazar organizaciones. Es un atributo de la persona, no una membresía. No hay alta self-service. |
| Visitante anónimo | Consultar el directorio público. Sin cuenta. |

### Donante

**[CONFIRMADO]** El donante **puede tener cuenta o no tenerla**. Las dos formas conviven: se puede donar de forma anónima o identificada sin registrarse, y también existirá el donante registrado.

Consecuencia de diseño: el modelo de donación **no debe asumir que el donante es texto libre** ni que siempre es un usuario. Hoy el código solo soporta la variante sin cuenta.

**[A DEFINIR]** Qué gana el donante con cuenta (¿historial de lo que donó? ¿seguir organizaciones? ¿comprometerse a donar?) y si entra en esta iteración o es roadmap.

### Plano de organización

**[PROVISORIO]** Los cuatro roles y sus permisos son correctos **por ahora**, pero el equipo no los dio por definitivos. No los tomes como cerrados: una historia que dependa de un permiso puntual conviene consultarla.

Una persona tiene un rol *por cada* organización a la que pertenece.

| Rol | Puede |
|---|---|
| `owner` | Todo dentro de su organización. Nace con quien la creó; no se transfiere ni se asigna. |
| `admin` | Gestionar miembros e invitaciones, y todo el contenido. |
| `coordinador` | Gestionar contenido. No gestiona miembros. |
| `voluntario` | Solo lectura. |

**[A DEFINIR]** Si existirá un **auditor o ente externo** con lectura ampliada respecto del visitante anónimo.

## 4. Organización — ciclo de vida

```
pending ──validar──> validated
   ├────rechazar──> rejected (con motivo)
   └─── rejected ──corregir y volver a postularse──> pending
```

- **[CONFIRMADO]** La validación es **discrecional**: el administrador revisa que la organización exista y que sus datos sean creíbles, y decide. No hay checklist formal ni documentación obligatoria.
- **[CONFIRMADO]** Una organización **rechazada puede volver a postularse**: corrige y vuelve a `pending`. El rechazo no es terminal.
- Al rechazar se deja un motivo.
- **Una organización que no está `validated` no opera**: nada del plano de organización le funciona.

## 5. Cuentas y acceso

- El alta exige aceptar los términos y **verificar el correo**. Sin verificar no hay login. El token vence.
- Recuperación de contraseña por correo, con token y vencimiento.
- Se suma gente por **invitación**: token con vencimiento y el rol ya definido.
- Los permisos se **revalidan en cada request**. Si a alguien le bajan el rol, aplica de inmediato y no cuando expire su sesión.
- Una persona puede pertenecer a más de una organización y cambiar de contexto entre ellas.

## 6. Insumos y necesidades

### Catálogo de insumos

**[CONFIRMADO]** El catálogo es **base global de la plataforma más insumos propios de cada organización**. La plataforma provee un catálogo base común; cada organización puede agregar los suyos.

El motivo es §0: sin base común el directorio público no puede cruzar necesidades entre organizaciones ni responder "quién necesita arroz", y eso mata la mitad de difusión del producto. Sin insumos propios, la mitad de gestión interna queda corta.

**El código hoy no hace esto**: el catálogo es enteramente por organización. Discrepancia §12.1, requiere migración.

### Necesidad: plantilla y publicación

**[CONFIRMADO en su dirección — [A DEFINIR] la precisión]** Una necesidad se **guarda como plantilla** y después se **publica**. La organización define una vez lo que suele necesitar y lo publica cuando le hace falta, sin redefinirlo cada vez.

Pendiente de precisar con el equipo:
- ¿La plantilla es de la organización o global de la plataforma (apoyada en el catálogo base)?
- ¿Qué atributos viven en la plantilla y cuáles en la publicación?
- ¿Una plantilla puede tener varias publicaciones abiertas a la vez?

Consecuencia que ya se puede afirmar: **reabrir una necesidad deja de ser la pregunta**. Una publicación se cierra, y volver a pedir lo mismo es publicar de nuevo la plantilla.

El código hoy tiene la necesidad como entidad única, sin plantilla. Discrepancia §12.3.

### Cobertura

- **[CONFIRMADO]** Cuando se recibe **más de lo requerido**, el exceso **se registra** y la necesidad se cierra. La cantidad cubierta puede superar a la requerida: queda constancia de cuánto entró realmente.
- **[CONFIRMADO]** La cobertura se puede **ajustar a mano** además de subir por donaciones, pero **debe quedar registrado quién lo hizo y por qué**. Sin esa traza el número no es auditable, y un número de cobertura que nadie puede explicar no sirve ni para la organización ni para el donante.

  El código hoy permite el ajuste **sin traza**. Discrepancia §12.4.
- Una necesidad referencia un insumo **de la misma organización**, restricción impuesta a nivel de esquema.

## 7. Donaciones

### Estados

**[CONFIRMADO]** La donación **tiene estado**, y el modelo debe soportar **agregar estados nuevos en el futuro** sin rehacerlo. Se implementa con el **patrón State**.

**Decisión de diseño tomada, implementación diferida:** hoy la donación nace recibida y no hay máquina de estados. Lo que se documenta ahora es que el modelo **no debe asumir estado único**, para que sumar "comprometida", "en tránsito" o "rechazada" después sea agregar un estado y no rediseñar la entidad. Merece ADR (§11.1).

### Quién registra una donación

**[CONFIRMADO]** El caso de uso pertenece al **responsable de la organización**: es quien recibe la donación y la registra.

`owner` y `admin` **también pueden**, por permiso heredado, pero **sin caso de uso dedicado**: no hay flujo pensado para ellos, es una capacidad forzada. Distinción que importa al diseñar la UI y al escribir escenarios — el camino feliz es el del responsable.

> **[A DEFINIR]** A qué rol de la tabla de §3 corresponde exactamente "responsable". Por la descripción de permisos parecería ser `coordinador`, pero no está confirmado y no conviene asumirlo.

### Resto

- La fecha de la donación es la fecha en que se registró el ingreso.
- El donante puede ser anónimo, identificado sin cuenta, o registrado (§3).
- Una donación agrupa uno o más ítems; cada ítem dice qué insumo y cuánto.
- Un ítem **puede no corresponder a ninguna necesidad publicada**: se puede donar algo que no se había pedido y se registra igual.
- Una donación puede asociarse a un punto de recolección, o a ninguno si se recibió en la sede.
- Todo lo que una donación referencia es **de la misma organización**, por esquema.

## 8. Puntos de recolección

Lugar físico con dirección, coordenadas y horarios por día de la semana. Sirven para que el donante sepa dónde y cuándo acercar lo que quiere donar.

## 9. Imágenes

**[CONFIRMADO]** Manejan imágenes: **organización, publicaciones e insumos**.

- **Organización**: logo y portada. Implementado.
- **Publicaciones**: imagen de la novedad. Es lo esperable para difusión (§0).
- **Insumos**: imagen del insumo, para que el directorio público se entienda mejor.

Las dos últimas **no están implementadas**: hoy la media polimórfica solo se usa para organización. Roadmap §11.4.

**[A DEFINIR]** Quién puede subirlas y si hay moderación. Por defecto se asume que quien gestiona contenido también gestiona sus imágenes.

## 10. Directorio público

- Cualquiera, sin cuenta, busca organizaciones por texto y categoría, y ve la ficha de una con sus necesidades abiertas.
- Solo aparecen organizaciones `validated`.
- Es la única superficie que no pasa por el aislamiento por organización: su función es mostrar varias.
- Por §0, es **mitad del producto**, no un extra.

## 11. Invariantes duras

Verdades que el agente afirma sin preguntar. Duplicadas en el prompt de `hornerito-domain-expert` como caché.

1. Un dato pertenece a **una y solo una** organización.
2. Una organización que no está `validated` **no opera**.
3. Un `voluntario` **nunca escribe contenido**. **[PROVISORIO]**
4. El rol `owner` **no se asigna ni se transfiere**. **[PROVISORIO]**
5. Una cuenta sin correo verificado **no inicia sesión**.
6. Los permisos se revalidan en cada request; el token no es la fuente de verdad del rol.
7. Nada de una organización referencia datos de otra.
8. Una organización rechazada **puede volver a postularse**. **[CONFIRMADO]**
9. La cobertura de una necesidad **puede superar** lo requerido; el exceso se registra. **[CONFIRMADO]**
10. Todo ajuste manual de cobertura **deja traza de quién y por qué**. **[CONFIRMADO]**
11. El donante puede ser anónimo, identificado sin cuenta, o registrado. **[CONFIRMADO]**
12. El directorio público muestra **solo** organizaciones `validated`.
13. Un ítem de donación puede existir sin necesidad asociada.
14. La difusión pública y la gestión interna **pesan igual**. **[CONFIRMADO]**

> Cayó la invariante "una donación no tiene estados": era una lectura del código, la reemplaza §7.
> Las marcadas **[PROVISORIO]** dependen de la tabla de roles, que el equipo no dio por final.

## 12. Roadmap — decidido pero no implementado

| # | Qué | Estado |
|---|---|---|
| 1 | Donación con máquina de estados vía patrón State | **[CONFIRMADO]** como decisión de diseño. No se implementa todavía. Necesita ADR |
| 2 | Catálogo de insumos base global + propios por organización | **[CONFIRMADO]**. Requiere migración |
| 3 | Necesidad como plantilla + publicación | **[CONFIRMADO]** en dirección, **[A DEFINIR]** el alcance |
| 4 | Imágenes en publicaciones e insumos | **[CONFIRMADO]**. Hoy solo organización |
| 5 | Traza de quién y por qué en el ajuste manual de cobertura | **[CONFIRMADO]**. Hoy el ajuste no deja rastro |
| 6 | Donante con cuenta | **[CONFIRMADO]** que existirá. **[A DEFINIR]** qué le da y si entra en esta iteración |

**[A RELEVAR]** El equipo completo todavía no revisó si hay más reglas acordadas que el código no implementa. Es pendiente de la próxima reunión.

## 13. Discrepancias entre código y negocio

| # | Qué hace el código | Qué pide el negocio |
|---|---|---|
| 1 | Catálogo de insumos enteramente por organización | Base global + propios (§6). **El negocio gana**: hay que migrar |
| 2 | Donación con estado único implícito | Modelo preparado para múltiples estados (§7). Diferido, pero no consolidar el diseño actual |
| 3 | Necesidad como entidad única, sin plantilla | Plantilla + publicación (§6) |
| 4 | La cobertura se ajusta a mano sin dejar rastro | El ajuste se permite, pero **con traza de quién y por qué** (§6) |
| 5 | Media polimórfica usada solo para organización | También publicaciones e insumos (§9) |
| 6 | Donante siempre sin cuenta | Con o sin cuenta (§3) |
| 7 | Sin SMTP los correos van al log en vez de fallar | Degradación deliberada para desarrollo, pero un alta parece exitosa y el usuario nunca recibe el enlace |

## 14. Trazabilidad y proceso

Cada user story de Jira tiene clave `QK-NN`, y la misma clave aparece en tres lugares:

```
.jira/QK-NN.md                  el requisito
test/acceptance/QK-NN.feature   la verificación
feat(alcance): ... (QK-NN)      el cambio
```

**[CONFIRMADO]** Las ramas son **por funcionalidad, con nombre conceptual**, no por historia: `necesidad`, `organizacion`, `publicacion`, `donacion`. Varias historias de la misma funcionalidad comparten rama.

**[CONFIRMADO]** **No hace falta aprobación para mergear a `develop`**: cada uno mergea lo suyo.

> Dos consecuencias que conviene tener presentes:
> - Una rama junta varias historias, así que el gate de aceptación en el PR verifica un conjunto, no una historia sola.
> - Sin aprobación obligatoria, **el CI informa pero no bloquea**: nadie mira el resultado antes de mergear salvo el propio autor. Si más adelante se quiere que ATDD sea un gate real y no una convención, esto es lo primero que hay que cambiar.

**[A DEFINIR]** Tipos de issue de Jira y en qué campo viven los criterios de aceptación. Se resuelve en la próxima iteración con un export de muestra en `.jira/raw/`; ahí se ajusta el importador contra los headers reales.

## 15. Preguntas abiertas

**Cerradas** (rondas del 2026-08-15): problema que resuelve el producto, catálogo de insumos, estados de donación, validación y repostulación de organizaciones, exceso sobre lo requerido, ajuste manual con traza, donante con o sin cuenta, quién registra donaciones, imágenes por entidad, convención de ramas, aprobación de PR.

**Abiertas:**

1. **Necesidad como plantilla** — ¿la plantilla es de la organización o global? ¿Qué atributos van en cada lado? ¿Varias publicaciones abiertas de la misma plantilla? (§6)
2. **"Responsable"** — a qué rol de §3 corresponde exactamente el responsable que registra donaciones (§7)
3. **Donante con cuenta** — qué le da tener cuenta, y si entra en esta iteración (§3)
4. **Auditor o ente externo** — ¿existirá? (§3)
5. **Roles y permisos** — la tabla de §3 es provisoria; ¿cuál es la definitiva?
6. **Imágenes** — quién puede subirlas, si hay moderación (§9)
7. **Reglas acordadas y no implementadas** — relevar con el equipo completo si hay más allá de las 6 de §12
8. **Jira** — tipos de issue y campo de criterios de aceptación (§14)
