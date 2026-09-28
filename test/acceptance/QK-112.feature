# language: es
Característica: Cargar la ubicación de la organización
  Como responsable de una organización quiero elegir la localidad de mi
  organización desde un buscador de direcciones para que quien busca ayuda en
  mi zona pueda encontrarme.

  La localidad se elige de una lista de sugerencias, nunca se escribe a mano:
  es lo que hace que dos organizaciones de la misma localidad queden escritas
  igual y se puedan agrupar. Al elegir una sugerencia se guardan juntas la
  localidad, la provincia y el país.

  Antecedentes:
    Dado que existe una organización con su responsable

  Escenario: Elegir la localidad
    Cuando el responsable elige la localidad "Villa María" de las sugerencias y guarda su perfil
    Entonces el perfil queda con la localidad "Villa María", la provincia "Córdoba" y el país "Argentina"
    Y el resto de los datos del perfil no cambió

  Escenario: Guardar sin elegir localidad
    Cuando el responsable guarda su perfil sin tocar el buscador de localidad
    Entonces el perfil se guarda sin errores
    Y el perfil queda sin localidad

  Escenario: El buscador de direcciones no responde
    Dado que el buscador de direcciones no responde
    Cuando el responsable busca su localidad
    Entonces no aparece ninguna sugerencia y no se muestra un error
    Y el responsable puede guardar el resto de su perfil igual

  Escenario: Cambiar una localidad ya cargada
    Dado que el perfil ya tiene cargada la localidad "Villa María"
    Cuando el responsable elige la localidad "Río Cuarto" de las sugerencias y guarda su perfil
    Entonces el perfil queda con la localidad "Río Cuarto", la provincia "Córdoba" y el país "Argentina"

  Escenario: Cada organización con lo suyo
    Dado que existe otra organización con su propio responsable
    Y que el perfil ya tiene cargada la localidad "Villa María"
    Cuando el responsable de la otra organización elige la localidad "Río Cuarto" de las sugerencias y guarda su perfil
    Entonces cada organización conserva su propia localidad
