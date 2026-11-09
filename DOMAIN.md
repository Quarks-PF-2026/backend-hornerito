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
| **Donación económica** | Aporte en dinero que el donante **declara** desde la ficha pública y que la organización confirma o rechaza. Se distingue de la donación presencial (en especie, la registra la organización al recibirla). Detalle en §7. |
| **Datos de cobro** | Datos que la organización carga para recibir donaciones económicas. Sin ellos no hay sección económica en su ficha (§10). |
| **Organización publicada** | **[CONFIRMADO]** (2026-11-08) Organización en estado `validated` (§4). |
| **Ranking de donantes** | Top mensual de donantes con cuenta por monto de donaciones económicas. Detalle en §17. |
| **Perfil público del donante** | Página pública de un donante con cuenta. Detalle en §17. |
| **Punto de recolección** | Lugar físico donde la organización recibe donaciones, con horarios y ubicación. |
| **Publicación** (*post*) | Novedad que la organización difunde. |
| **Historia** (*story*) | **[CONFIRMADO 2026-11-08, QK-111]** Imagen o video corto de una organización, con texto opcional encima y enlace opcional, **vigente 7 días** desde su publicación. No confundir con la user story de Jira (§14). Detalle en §18. |
| **Membresía** | Vínculo entre una persona y una organización, con un rol. |
| **Invitación** | Token con vencimiento por el cual una organización suma a alguien. |
| **Evento** | Ocasión de servicio de una organización: periódico (en días de la semana elegidos) o extraordinario (fecha puntual), con hora de comienzo. Detalle en §16. |
| **Ocurrencia** | Par (evento, fecha); instancia concreta de un evento. No se persiste. Detalle en §16. |
| **Asistencia** | Conteo agregado de beneficiarios atendidos en una ocurrencia. Detalle en §16. |

## 3. Actores y roles

### Plano de plataforma

| Actor | Puede |
|---|---|
| Administrador de plataforma | Validar y rechazar organizaciones. Es un atributo de la persona, no una membresía. No hay alta self-service. |
| Visitante anónimo | Consultar el directorio público, el ranking de donantes y los perfiles públicos de donantes (§17). Sin cuenta. |

### Donante

**[CONFIRMADO]** El donante **puede tener cuenta o no tenerla**. Las dos formas conviven: se puede donar de forma anónima o identificada sin registrarse, y también existirá el donante registrado.

Consecuencia de diseño: el modelo de donación **no debe asumir que el donante es texto libre** ni que siempre es un usuario. Hasta el Sprint 6 el código solo soportaba la variante sin cuenta; QK-113 lo resuelve (§13.6).

**[CONFIRMADO]** (2026-11-08) El donante con cuenta **entra en esta iteración** (Sprint 6). Le da:
- Que su donación económica declarada con sesión iniciada **quede asociada a su cuenta** (QK-113, §7).
- Figurar en el **ranking mensual de donantes**, global y por organización (QK-114, QK-115, §17).
- Un **perfil público de donante** (QK-110, §17).

Donar con cuenta **no requiere ser miembro** de la organización: es un vínculo distinto de la membresía.

**[A DEFINIR]** Historial propio de lo donado, seguir organizaciones y comprometerse a donar. Fuera de esta iteración.

### Plano de organización

**[PROVISORIO]** Los cuatro roles y sus permisos son correctos **por ahora**, pero el equipo no los dio por definitivos. No los tomes como cerrados: una historia que dependa de un permiso puntual conviene consultarla.

Una persona tiene un rol *por cada* organización a la que pertenece.

| Rol | Puede |
|---|---|
| `owner` | Todo dentro de su organización. Nace con quien la creó; no se transfiere ni se asigna. |
| `admin` | Gestionar miembros e invitaciones, y todo el contenido. |
| `coordinador` | Gestionar contenido. No gestiona miembros. |
| `voluntario` | Solo lectura. |

**[CONFIRMADO]** Excepción: el `voluntario` puede cargar y corregir la asistencia de un evento — es la única escritura que hace. Regla completa en §16.

**[A DEFINIR]** Si existirá un **auditor o ente externo** con lectura ampliada respecto del visitante anónimo.

## 4. Organización — ciclo de vida

```
pending ──validar──> validated
   ├────rechazar──> rejected (con motivo)
   └─── rejected ──corregir y volver a postularse──> pending
```

- **[CONFIRMADO]** La validación es **discrecional**: el administrador revisa que la organización exista y que sus datos sean creíbles, y decide. No hay checklist formal ni documentación obligatoria.
- **[CONFIRMADO]** Una organización **rechazada puede volver a postularse**: corrige y vuelve a `pending`. El rechazo no es terminal. Vuelve a `pending` **únicamente cuando el `owner` corrige sus datos** (2026-09-13, QK-19).
- **[CONFIRMADO]** Una organización **nace `pending`** (2026-09-13, QK-19).
- **Una organización que no está `validated` no opera**: nada del plano de organización le funciona.

### Validación (QK-19)

Confirmado con el usuario el 2026-09-13.

- **[CONFIRMADO]** **Cola de validación**: muestra **solo** organizaciones `pending`, ordenadas por fecha de solicitud, **la más antigua primero**. Por cada una: datos del perfil (nombre, descripción, dirección, contacto), el representante y la fecha de solicitud. No se exige documentación adjunta (consistente con la validación discrecional).
- **[CONFIRMADO]** Solo se valida o rechaza una organización en `pending`.
- **[CONFIRMADO]** Al rechazar se deja un motivo.
- **[CONFIRMADO]** El **representante** es el `owner` de la organización. Se le avisa **por correo** tanto la aprobación como el rechazo; el aviso de rechazo incluye el motivo.
- **[A DEFINIR]** Revocar una organización `validated`. Fuera del alcance de QK-19.

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

**Implementado para la económica, diferido para la presencial:** la donación **económica** tiene estados desde QK-20 (abajo), con patrón State. La **presencial** nace recibida y no tiene estados. El modelo **no debe asumir estado único**, para que sumar "comprometida" o "en tránsito" después sea agregar un estado y no rediseñar la entidad. Merece ADR (§12.1).

### Quién registra una donación

**[CONFIRMADO]** El caso de uso pertenece al **responsable de la organización**: es quien recibe la donación y la registra.

`owner` y `admin` **también pueden**, por permiso heredado, pero **sin caso de uso dedicado**: no hay flujo pensado para ellos, es una capacidad forzada. Distinción que importa al diseñar la UI y al escribir escenarios — el camino feliz es el del responsable.

> **[A DEFINIR]** A qué rol de la tabla de §3 corresponde exactamente "responsable". Por la descripción de permisos parecería ser `coordinador`, pero no está confirmado y no conviene asumirlo.

### Donación económica (QK-20, QK-113)

Confirmado con el usuario el 2026-11-08.

- **[CONFIRMADO]** (QK-20) La donación económica la **declara el donante**. Estados:

  ```
  declarada ──confirmar──> confirmada
      └──────rechazar──> rechazada
  ```

  La confirma o rechaza un `owner` o `admin` de la organización, **contra el extracto**. La donación presencial sigue sin estados.
- **[CONFIRMADO]** (QK-113) Declarada **con sesión iniciada**, queda **asociada a la cuenta** del donante. No requiere ser miembro de la organización. **No es retroactiva**: las donaciones declaradas antes, o sin sesión, no se asocian.
- **[CONFIRMADO]** (QK-113) Con sesión, nombre y contacto vienen **precargados de la cuenta**; se pueden editar **solo para esa donación**, sin tocar el perfil.
- **[CONFIRMADO]** (QK-113) Sin sesión se dona como antes.
- **[CONFIRMADO]** (QK-113) **Anónima con sesión**: queda asociada a la cuenta igual, y la **organización sigue viendo nombre y contacto** en su panel. "Anónima" significa **anónima frente al público**, no sin datos: ninguna superficie pública muestra su nombre (ranking y perfil la excluyen, §17).

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

Publicaciones e insumos **no están implementados**: hoy la media polimórfica solo se usa para organización. Roadmap §12.4.

- **[CONFIRMADO 2026-11-08, QK-111]** **Historias**: imagen o video corto, con sus propios límites de formato y tamaño (§18).

**[A DEFINIR]** Quién puede subirlas y si hay moderación. Por defecto se asume que quien gestiona contenido también gestiona sus imágenes. Para historias, quién publica ya está definido (§18).

## 10. Directorio público

- Cualquiera, sin cuenta, busca organizaciones por texto y categoría, y ve la ficha de una con sus necesidades abiertas.
- Solo aparecen organizaciones `validated`.
- **[CONFIRMADO]** (2026-11-08) La sección de **donación económica** de la ficha solo existe si la organización cargó sus **datos de cobro**.
- El inicio muestra el ranking mensual global de donantes y la ficha el top de la organización (§17).
- **[CONFIRMADO 2026-11-08, QK-111]** El inicio muestra las **historias vigentes** de organizaciones `validated`, y el perfil público de la organización las suyas (§18).
- Directorio, ranking e historias del inicio son las únicas superficies que no pasan por el aislamiento por organización: su función es mostrar varias.
- Por §0, es **mitad del producto**, no un extra.

## 11. Invariantes duras

Verdades que el agente afirma sin preguntar. Duplicadas en el prompt de `hornerito-domain-expert` como caché.

1. Un dato pertenece a **una y solo una** organización.
2. Una organización que no está `validated` **no opera**.
3. Un `voluntario` **nunca escribe contenido**. **[PROVISORIO]** — excepción confirmada: puede cargar/corregir asistencia de un evento (§16).
4. El rol `owner` **no se asigna ni se transfiere**. **[PROVISORIO]**
5. Una cuenta sin correo verificado **no inicia sesión**.
6. Los permisos se revalidan en cada request; el token no es la fuente de verdad del rol.
7. Nada de una organización referencia datos de otra.
8. Una organización rechazada **puede volver a postularse**. **[CONFIRMADO]**
9. La cobertura de una necesidad **puede superar** lo requerido; el exceso se registra. **[CONFIRMADO]**
10. Todo ajuste manual de cobertura **deja traza de quién y por qué**. **[CONFIRMADO]**
11. El donante puede ser anónimo, identificado sin cuenta, o registrado. **[CONFIRMADO]** "Anónimo" es frente al público: la organización puede ver nombre y contacto (§7, QK-113, 2026-11-08).
12. El directorio público muestra **solo** organizaciones `validated`.
13. Un ítem de donación puede existir sin necesidad asociada.
14. La difusión pública y la gestión interna **pesan igual**. **[CONFIRMADO]**
15. Un evento **nunca se borra**; darlo de baja solo detiene sus ocurrencias futuras. **[CONFIRMADO]**
16. Una ocurrencia tiene **a lo sumo una** asistencia; cargarla de nuevo la reemplaza. **[CONFIRMADO]**
17. La asistencia **nunca se expone** en el directorio público ni en la ficha de organización. **[CONFIRMADO]**
18. Ninguna superficie pública muestra el **contacto de un donante**. **[CONFIRMADO]** (2026-11-08, QK-110/113/114/115)
19. Una historia **nunca se borra físicamente**: vencer o eliminarla solo la oculta (§18). **[CONFIRMADO 2026-11-08, QK-111]**

> Cayó la invariante "una donación no tiene estados": era una lectura del código, la reemplaza §7.
> Las marcadas **[PROVISORIO]** dependen de la tabla de roles, que el equipo no dio por final.

## 12. Roadmap — decidido pero no implementado

| # | Qué | Estado |
|---|---|---|
| 1 | Donación con máquina de estados vía patrón State | **[CONFIRMADO]** como decisión de diseño. **Implementado para la económica** desde QK-20 (`declarada`/`confirmada`/`rechazada`, `src/modules/donation/monetary/states/`); la presencial sigue sin estados (§7). Antes figuraba "no se implementa todavía". Necesita ADR |
| 2 | Catálogo de insumos base global + propios por organización | **[CONFIRMADO]**. Requiere migración |
| 3 | Necesidad como plantilla + publicación | **[CONFIRMADO]** en dirección, **[A DEFINIR]** el alcance |
| 4 | Imágenes en publicaciones e insumos | **[CONFIRMADO]**. Hoy solo organización |
| 5 | Traza de quién y por qué en el ajuste manual de cobertura | **[CONFIRMADO]**. Hoy el ajuste no deja rastro |
| 6 | Donante con cuenta | **[CONFIRMADO]** (2026-11-08) entra en Sprint 6: asociación de la donación económica (QK-113), ranking (QK-114, QK-115) y perfil público (QK-110), §3. **[A DEFINIR]** historial propio, seguir organizaciones, comprometerse a donar |

**[A RELEVAR]** El equipo completo todavía no revisó si hay más reglas acordadas que el código no implementa. Es pendiente de la próxima reunión.

## 13. Discrepancias entre código y negocio

| # | Qué hace el código | Qué pide el negocio |
|---|---|---|
| 1 | Catálogo de insumos enteramente por organización | Base global + propios (§6). **El negocio gana**: hay que migrar |
| 2 | ~~Donación con estado único implícito~~ | Modelo preparado para múltiples estados (§7). **Resuelta → R2** |
| 3 | Necesidad como entidad única, sin plantilla | Plantilla + publicación (§6) |
| 4 | La cobertura se ajusta a mano sin dejar rastro | El ajuste se permite, pero **con traza de quién y por qué** (§6) |
| 5 | Media polimórfica usada solo para organización | También publicaciones e insumos (§9) |
| 6 | Hasta QK-113, donante siempre sin cuenta | Con o sin cuenta (§3). **En resolución**: QK-113 implementada en rama `donacion`, pendiente de validación del PO; pasa a Resueltas cuando se valide |
| 7 | Sin SMTP los correos van al log en vez de fallar | Degradación deliberada para desarrollo, pero un alta parece exitosa y el usuario nunca recibe el enlace |

**Resueltas:**

| # | Qué hacía el código | Qué pide el negocio | Resolución |
|---|---|---|---|
| R1 | Hasta QK-19, `createMine` creaba la organización ya `validated` (QK-13) | Nace `pending` y la valida el administrador de plataforma (§4) | QK-19 lo corrige: la organización nace `pending` |
| R2 | Hasta QK-20, donación con estado único implícito (ex fila 2) | Modelo preparado para múltiples estados (§7) | QK-20: la económica tiene `declarada`/`confirmada`/`rechazada` con patrón State (`src/modules/donation/monetary/states/`). La presencial sigue sin estados, por decisión (§7) |

## 14. Trazabilidad y proceso

Cada user story de Jira tiene clave `QK-NN`, y la misma clave aparece en tres lugares:

```
QK-NN en Jira                   el requisito
test/acceptance/QK-NN.feature   la verificación
feat(alcance): ... (QK-NN)      el cambio
```

**[CONFIRMADO]** Las ramas son **por funcionalidad, con nombre conceptual**, no por historia: `necesidad`, `organizacion`, `publicacion`, `donacion`. Varias historias de la misma funcionalidad comparten rama.

**[CONFIRMADO]** **No hace falta aprobación para mergear a `develop`**: cada uno mergea lo suyo.

> Dos consecuencias que conviene tener presentes:
> - Una rama junta varias historias, así que el gate de aceptación en el PR verifica un conjunto, no una historia sola.
> - Sin aprobación obligatoria, **el CI informa pero no bloquea**: nadie mira el resultado antes de mergear salvo el propio autor. Si más adelante se quiere que ATDD sea un gate real y no una convención, esto es lo primero que hay que cambiar.

**[CONFIRMADO]** Tipos de issue del proyecto QK, en español: `Epic`, `Historia`, `Tarea`, `Error`, `Feature`, `Recurso`, `Subtask`. Las user stories son de tipo `Historia`. Los criterios de aceptación no están en `description` (viene vacío): viven en un campo personalizado del proyecto, junto con las reglas, las pruebas de usuario y las notas de implementación. Detalle operativo (nombres de campos y tools) en la skill `jira-ticket`.

## 15. Preguntas abiertas

**Cerradas** (rondas del 2026-08-15): problema que resuelve el producto, catálogo de insumos, estados de donación, validación y repostulación de organizaciones, exceso sobre lo requerido, ajuste manual con traza, donante con o sin cuenta, quién registra donaciones, imágenes por entidad, convención de ramas, aprobación de PR, tipos de issue y campo de criterios de aceptación de Jira.

**Abiertas:**

1. **Necesidad como plantilla** — ¿la plantilla es de la organización o global? ¿Qué atributos van en cada lado? ¿Varias publicaciones abiertas de la misma plantilla? (§6)
2. **"Responsable"** — a qué rol de §3 corresponde exactamente el responsable que registra donaciones (§7)
3. **Donante con cuenta** — resuelto en parte el 2026-11-08: entra en Sprint 6 con asociación de la donación económica, ranking y perfil público (§3). Sigue abierto: historial propio, seguir organizaciones, comprometerse a donar
4. **Auditor o ente externo** — ¿existirá? (§3)
5. **Roles y permisos** — la tabla de §3 es provisoria; ¿cuál es la definitiva?
6. **Imágenes** — quién puede subirlas, si hay moderación (§9)
7. **Reglas acordadas y no implementadas** — relevar con el equipo completo si hay más allá de las 6 de §12
8. **Plazo límite de corrección de asistencia** — por ahora ninguno (§16)

## 16. Eventos y asistencia (QK-116, QK-117)

Confirmado con el usuario el 2026-09-27.

### Evento

- **[CONFIRMADO]** Un **evento** es una ocasión de servicio de una organización. Dos tipos:
  - **Periódico**: se repite en los **días de la semana** que se elijan (al menos uno; ej. lunes, miércoles y viernes). "Diario" es elegir los siete días (ej. la merienda). Confirmado con el usuario el 2026-10-05.
  - **Extraordinario**: una fecha puntual (ej. una colecta). No lleva días de la semana.
- **[CONFIRMADO]** Todo evento tiene una **hora de comienzo** (HH:MM, 24 h), obligatoria al crearlo. Es **informativa**: no restringe cuándo se carga la asistencia. Confirmado con el usuario el 2026-10-05.
- **[CONFIRMADO]** Crear, editar y dar de baja un evento: `owner`, `admin`, `coordinador`. El `voluntario` solo ve (§3).
- **[CONFIRMADO]** Un evento **sin asistencia registrada** se edita libremente. Un evento **con asistencia registrada** solo permite cambiar el nombre y la hora de comienzo (no el tipo, la fecha de inicio ni los días de la semana) o darlo de baja. Confirmado con el usuario el 2026-10-05.
- **[CONFIRMADO]** Dar de baja un evento: deja de generar ocurrencias **desde el día siguiente**; las ocurrencias y asistencias pasadas se conservan. **Los eventos nunca se borran** (invariante 15, §11).

### Ocurrencia

- **[CONFIRMADO]** Una **ocurrencia** es el par (evento, fecha). **No se persiste**, se calcula:
  - Periódico: una ocurrencia por cada día, desde la fecha de inicio hasta hoy (o hasta la fecha de baja, si el evento fue dado de baja), que caiga en uno de sus días de la semana. Confirmado con el usuario el 2026-10-05.
  - Extraordinario: una única ocurrencia, en su fecha.

### Asistencia

- **[CONFIRMADO]** La **asistencia** es un conteo agregado (entero ≥ 0) de beneficiarios atendidos en una ocurrencia. **No es nominal**: no identifica personas.
- **[CONFIRMADO]** Una asistencia por ocurrencia (invariante 16, §11). Cargarla de nuevo **la corrige**: reemplaza el valor anterior, no lo acumula.
- **[CONFIRMADO]** Cargar o corregir una asistencia: **cualquier miembro activo de la organización**, `voluntario` incluido. Excepción explícita a "voluntario = solo lectura" (§3).
- **[CONFIRMADO]** No se puede cargar asistencia en una **fecha futura**, ni en una fecha que no sea ocurrencia del evento.
- **[NO CONFIRMADO]** Plazo límite de corrección de un conteo — por ahora ninguno.
- **[CONFIRMADO]** La asistencia es **interna**: nunca se expone en el directorio público ni en la ficha de organización (invariante 17, §11). Es **independiente** del estado de las necesidades (§6). A futuro alimenta la predicción con IA de QK-118.

## 17. Ranking de donantes y perfil público (QK-110, QK-114, QK-115)

Confirmado con el usuario el 2026-11-08.

### Qué donación cuenta

Reglas de suma comunes al ranking y al perfil público:

- **[CONFIRMADO]** Solo **donaciones económicas confirmadas** (§7), **asociadas a una cuenta**, **no anónimas**, a **organizaciones publicadas** (`validated`). Las rechazadas nunca cuentan.
- **[CONFIRMADO]** Mes **calendario en hora Argentina**. La donación cuenta en el mes de su **declaración** (fecha de registro), aunque se confirme después.
- **[CONFIRMADO]** Solo económicas: el ranking de insumos queda fuera hasta que se pueda identificar al donante presencial.

### Ranking mensual (QK-114, QK-115)

- **[CONFIRMADO]** Dos rankings: **global, top 10, en el inicio** (QK-114) y **por organización, top 5, en su ficha** (QK-115).
- **[CONFIRMADO]** Orden: **monto descendente**. Empate: primero quien **llegó antes a ese monto** (por fecha de declaración); después, alfabético.
- **[CONFIRMADO]** Se muestra **posición, nombre de la cuenta y monto**. Nunca el contacto (invariante 18, §11).
- **[CONFIRMADO]** Público, **sin sesión**. Sin datos en el mes, la sección **no se muestra**.
- **[CONFIRMADO]** El top de la ficha solo se muestra si la organización tiene **datos de cobro** (§10).
- **[CONFIRMADO]** (QK-115) Aparecer en el top de una organización **revela públicamente que esa persona le donó**: aceptado por diseño. Quien no quiera figurar marca la donación como anónima (§7).

### Perfil público del donante (QK-110)

- **[CONFIRMADO]** Muestra **nombre**, **"donante desde"** (mes/año de alta de la cuenta), **total del mes en curso** y **total histórico**, con las reglas de suma de arriba.
- **[CONFIRMADO]** Nunca muestra email, teléfono ni el **listado de organizaciones** a las que donó.
- **[CONFIRMADO]** Un usuario sin donaciones públicas confirmadas (ninguna que cuente según las reglas de arriba) **no tiene perfil público**: se responde como no encontrado.
- **[CONFIRMADO]** Se ve **sin sesión**.

## 18. Historias de organización (QK-111)

Confirmado con el usuario (en representación del equipo/PO) el 2026-11-08. Todas las reglas de esta sección son **[CONFIRMADO 2026-11-08, QK-111]**.

### Qué es y quién publica

- Una **historia** es una imagen o video corto de una organización, con **texto opcional** encima y **enlace opcional**. Está **vigente 7 días** desde su publicación.
- Publican `owner`, `admin` y `coordinador`; el `voluntario` no. Atada a la tabla de roles **[PROVISORIO]** (§3, §15.5).
- Solo organizaciones `validated` publican, y solo sus historias aparecen.
- **Máximo 20 historias vigentes** por organización.

### Contenido

- **Imagen**: ≤ 8 MB, JPEG, PNG o WebP.
- **Video**: ≤ 30 s y ≤ 20 MB, MP4 o WebM.
- Proporción vertical **9:16 recomendada, no exigida**: no se rechaza otra; el visor la encuadra.
- **Enlace**: solo URL `http`/`https`, de cualquier dominio.

### Vencimiento y eliminación

- **Vencida**: deja de mostrarse en el inicio y en el perfil público, pero el registro se conserva (invariante 19, §11).
- **Eliminar antes de vencer** es borrado lógico: se oculta igual que una vencida, se conserva el registro y **libera cupo** de las 20.
- Cualquier `owner`/`admin`/`coordinador` de la organización puede eliminar **cualquier** historia de su organización, no solo las propias.

### Dónde se ven

- **Inicio** (superficie pública entre organizaciones, §10): historias vigentes de organizaciones `validated`.
  - **Con cuenta**: una historia ya vista **no se le muestra más** en el inicio; la organización sigue en la barra mientras le quede alguna sin ver.
  - Abrir la historia en el inicio **o** en el perfil de la organización la marca como vista.
  - Los miembros ven las historias de su propia organización como cualquier usuario.
- **Perfil público de la organización**: todas sus historias vigentes, vistas o no.
- **Visitante sin cuenta**: ve todas las vigentes; no se registran vistas ni se oculta nada.
- **Panel de la organización**: las vigentes con su vencimiento y, debajo, las vencidas como **historial de solo lectura**. Las eliminadas no se muestran.
- **Aislamiento**: en el panel, una organización solo ve y elimina **sus propias** historias (invariante 1, §11).
