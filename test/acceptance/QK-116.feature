# language: es
Característica: Registrar Asistencia
  Como persona que participa de la organización quiero registrar, para cada
  ocurrencia de un evento, cuántos beneficiarios asistieron, para llevar un
  conteo agregado de uso interno de la organización.

  Antecedentes:
    Dado que existe una organización con su responsable
    Y que existe el evento "Merienda diaria"

  Escenario: Registrar el conteo de una ocurrencia
    Cuando el responsable registra que hoy asistieron 42 beneficiarios
    Entonces el conteo de hoy queda guardado en 42
    Y aparece en el historial interno de la organización

  Escenario: Corregir un conteo ya cargado
    Dado que ya se registró que hoy asistieron 42 beneficiarios
    Cuando el responsable corrige el conteo de hoy a 50 beneficiarios
    Entonces el conteo de hoy queda guardado en 50

  Escenario: El conteo no es un dato público
    Dado que ya se registró que hoy asistieron 42 beneficiarios
    Cuando un visitante sin cuenta entra a la ficha pública de la organización
    Entonces no ve ningún dato de asistencia

  Escenario: Un voluntario también puede cargar el conteo
    Dado que hay un voluntario en la organización
    Cuando el voluntario registra que hoy asistieron 15 beneficiarios
    Entonces el conteo de hoy queda guardado en 15

  Escenario: Otra organización no puede cargar asistencia en mi evento
    Dado que existe otra organización con su propio responsable
    Cuando el responsable de la otra organización intenta registrar asistencia en el evento "Merienda diaria"
    Entonces el sistema no se lo permite
    Y el responsable sí puede registrar la asistencia en su propio evento

  Escenario: No se puede cargar la asistencia de un día que todavía no llegó
    Cuando el responsable intenta registrar la asistencia de mañana
    Entonces el sistema no se lo permite

  Escenario: No se puede cargar asistencia en una fecha que no es ocurrencia del evento
    Dado que existe un evento extraordinario para la fecha de hace 2 días
    Cuando el responsable intenta registrar asistencia de hace 3 días en ese evento
    Entonces el sistema no se lo permite
