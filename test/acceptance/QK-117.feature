# language: es
Característica: Gestionar Eventos
  Como persona que participa de la organización quiero crear y administrar
  los eventos de mi organización (periódicos, como la merienda diaria, o
  extraordinarios, como una colecta puntual) para tener ocurrencias
  concretas sobre las que después registrar asistencia.

  Antecedentes:
    Dado que existe una organización con su responsable

  Escenario: Crear un evento periódico
    Cuando el responsable crea el evento periódico "Merienda diaria" que empezó hace 2 días
    Entonces el evento "Merienda diaria" queda creado
    Y hay una ocurrencia disponible por cada día desde que empezó hasta hoy

  Escenario: Crear un evento extraordinario
    Cuando el responsable crea el evento extraordinario "Colecta de invierno" para hoy
    Entonces el evento "Colecta de invierno" queda creado
    Y hay una única ocurrencia disponible, en esa fecha puntual

  Escenario: Editar el nombre de un evento sin asistencia registrada
    Dado que existe el evento "Merienda diaria"
    Cuando el responsable le cambia el nombre a "Merienda de la tarde"
    Entonces el cambio se guarda sin restricciones

  Escenario: Dar de baja un evento periódico conserva su historial
    Dado que existe el evento periódico "Merienda diaria" que empezó hace 3 días
    Y que se cargó la asistencia de hace 2 días
    Cuando el responsable da de baja el evento
    Entonces el evento deja de estar activo desde hoy
    Y las ocurrencias y la asistencia ya registradas siguen disponibles
    Y ya no se puede cargar la asistencia de mañana

  Escenario: Cada organización ve únicamente sus propios eventos
    Dado que existe el evento "Merienda diaria"
    Y que existe otra organización con su propio responsable y su propio evento "Ropero comunitario"
    Cuando el responsable pide el listado de sus eventos
    Entonces solo ve "Merienda diaria" en su listado

  Escenario: Un voluntario no puede crear eventos
    Dado que hay un voluntario en la organización
    Cuando el voluntario intenta crear el evento "Colecta de invierno"
    Entonces el sistema no se lo permite

  Escenario: Un voluntario no puede editar ni dar de baja un evento
    Dado que existe el evento "Merienda diaria"
    Y que hay un voluntario en la organización
    Cuando el voluntario intenta cambiarle el nombre al evento "Merienda diaria"
    Entonces el sistema no se lo permite
    Cuando el voluntario intenta dar de baja el evento "Merienda diaria"
    Entonces el sistema no se lo permite

  Escenario: Un evento con asistencia registrada solo permite editar el nombre
    Dado que existe el evento "Merienda diaria"
    Y que se cargó la asistencia de hoy
    Cuando el responsable intenta cambiarle el tipo a extraordinario
    Entonces el sistema no se lo permite
    Cuando el responsable intenta cambiarle la fecha de inicio
    Entonces el sistema no se lo permite
    Cuando el responsable le cambia el nombre
    Entonces el cambio se guarda sin restricciones
