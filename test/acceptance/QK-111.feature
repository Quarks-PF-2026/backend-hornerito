# language: es
Característica: Historias de organización
  Como responsable de una organización quiero publicar historias cortas (una
  imagen o un video, con texto y enlace opcionales) para mostrar el día a día
  de la organización a la comunidad.

  Una historia está vigente 7 días desde que se publica. Publican el dueño,
  los administradores y los coordinadores; los voluntarios no. Una
  organización puede tener hasta 20 historias vigentes. Las historias se ven
  en la barra del inicio y en el perfil público de la organización; quien
  tiene cuenta deja de ver en el inicio las que ya vio. Las vencidas y las
  eliminadas dejan de mostrarse, pero quedan registradas.

  Escenario: Publicar una historia con imagen y texto
    Dado que Comedor Los Pibes es una organización validada
    Cuando el responsable de Comedor Los Pibes publica una historia con una imagen JPG de 2 MB y el texto "Hoy cocinamos guiso"
    Entonces la historia queda publicada con la imagen y el texto "Hoy cocinamos guiso"
    Y vence 7 días después de publicada
    Y en el inicio, un visitante sin cuenta ve la nueva historia de Comedor Los Pibes
    Y en el perfil de Comedor Los Pibes, un visitante sin cuenta ve la nueva historia
    Y en el panel de Comedor Los Pibes, la nueva historia figura vigente

  Escenario: Publicar un video corto
    Dado que Comedor Los Pibes es una organización validada
    Cuando el responsable de Comedor Los Pibes publica una historia con un video MP4 de 25 segundos y 15 MB
    Entonces la historia queda publicada como un video de 25 segundos

  Escenario: Publicar una historia sin texto ni enlace
    Dado que Comedor Los Pibes es una organización validada
    Cuando el responsable de Comedor Los Pibes publica una historia con una imagen PNG de 1 MB
    Entonces la historia queda publicada sin texto ni enlace

  Escenario: Publicar una historia con texto y enlace
    Dado que Comedor Los Pibes es una organización validada
    Cuando el responsable de Comedor Los Pibes publica una historia con una imagen WEBP de 1 MB, el texto "Sumate el sábado" y el enlace "https://comedorlospibes.org/sabado"
    Entonces la historia queda publicada con el texto "Sumate el sábado" y el enlace "https://comedorlospibes.org/sabado"

  Escenario: Quien tiene cuenta deja de ver en el inicio la historia que ya vio
    Dado que Comedor Los Pibes publicó 2 historias
    Y que Ana Pérez tiene cuenta
    Cuando Ana Pérez mira la primera historia de Comedor Los Pibes en el inicio
    Entonces en el inicio, Ana Pérez ya no ve la primera historia de Comedor Los Pibes
    Y en el inicio, Ana Pérez ve a Comedor Los Pibes con 1 historia sin ver

  Escenario: Cuando vio todas, la organización sale de su barra pero no de la de los demás
    Dado que Comedor Los Pibes publicó 1 historia
    Y que Ana Pérez tiene cuenta
    Y que Bruno Díaz tiene cuenta
    Cuando Ana Pérez mira la primera historia de Comedor Los Pibes en el inicio
    Entonces en el inicio, Ana Pérez ya no ve a Comedor Los Pibes
    Y en el inicio, Bruno Díaz ve a Comedor Los Pibes con 1 historia sin ver

  Escenario: El perfil de la organización sigue mostrando la historia ya vista
    Dado que Comedor Los Pibes publicó 1 historia
    Y que Ana Pérez tiene cuenta
    Cuando Ana Pérez mira la primera historia de Comedor Los Pibes en el inicio
    Entonces en el perfil de Comedor Los Pibes, Ana Pérez ve la primera historia

  Escenario: Abrir la historia desde el perfil también cuenta como vista
    Dado que Comedor Los Pibes publicó 2 historias
    Y que Ana Pérez tiene cuenta
    Cuando Ana Pérez abre la primera historia de Comedor Los Pibes desde su perfil
    Entonces en el inicio, Ana Pérez ya no ve la primera historia de Comedor Los Pibes
    Y en el inicio, Ana Pérez ve a Comedor Los Pibes con 1 historia sin ver

  Escenario: A los 7 días la historia vence y pasa al historial del panel
    Dado que Comedor Los Pibes publicó 2 historias
    Y que pasaron 7 días desde la primera historia de Comedor Los Pibes
    Entonces en el inicio, un visitante sin cuenta no ve la primera historia de Comedor Los Pibes
    Y en el inicio, un visitante sin cuenta ve la segunda historia de Comedor Los Pibes
    Y en el perfil de Comedor Los Pibes, un visitante sin cuenta no ve la primera historia
    Y en el panel de Comedor Los Pibes, la primera historia figura en el historial de vencidas
    Y en el panel de Comedor Los Pibes, la segunda historia figura vigente

  Esquema del escenario: Un archivo que no cumple los requisitos no se publica
    Dado que Comedor Los Pibes es una organización validada
    Cuando el responsable de Comedor Los Pibes intenta publicar una historia con <archivo>
    Entonces el sistema rechaza la historia con un mensaje que menciona "<motivo>"
    Y en el panel de Comedor Los Pibes figuran 0 historias vigentes

    Ejemplos:
      | archivo                              | motivo     |
      | una imagen GIF de 1 MB               | formato    |
      | un video MOV de 10 segundos y 5 MB   | formato    |
      | un video MP4 de 45 segundos y 10 MB  | 30 segundos |
      | una imagen PNG de 12 MB              | 8 MB       |
      | un video WEBM de 20 segundos y 25 MB | 20 MB      |

  Escenario: El enlace tiene que ser una dirección web
    Dado que Comedor Los Pibes es una organización validada
    Cuando el responsable de Comedor Los Pibes intenta publicar una historia con una imagen JPG de 1 MB y el enlace "javascript:alert(1)"
    Entonces el sistema rechaza la historia con un mensaje que menciona "enlace"
    Y en el panel de Comedor Los Pibes figuran 0 historias vigentes

  Escenario: Un voluntario no puede publicar historias
    Dado que Comedor Los Pibes es una organización validada
    Y que Carla Gómez es voluntaria de Comedor Los Pibes
    Cuando Carla Gómez intenta publicar una historia con una imagen JPG de 1 MB
    Entonces el sistema no le permite publicarla
    Y en el panel de Comedor Los Pibes figuran 0 historias vigentes

  Escenario: No se pueden tener más de 20 historias vigentes
    Dado que Comedor Los Pibes publicó 20 historias
    Cuando el responsable de Comedor Los Pibes intenta publicar una historia con una imagen JPG de 1 MB
    Entonces el sistema rechaza la historia con un mensaje que menciona "20"
    Y en el panel de Comedor Los Pibes figuran 20 historias vigentes

  Escenario: Eliminar una historia libera lugar para otra
    Dado que Comedor Los Pibes publicó 20 historias
    Cuando el responsable de Comedor Los Pibes elimina la primera historia
    Y el responsable de Comedor Los Pibes publica una historia con una imagen JPG de 1 MB
    Entonces la historia queda publicada con la imagen
    Y en el panel de Comedor Los Pibes figuran 20 historias vigentes

  Escenario: Una historia eliminada deja de mostrarse pero queda registrada
    Dado que Comedor Los Pibes publicó 2 historias
    Cuando el responsable de Comedor Los Pibes elimina la primera historia
    Entonces en el inicio, un visitante sin cuenta no ve la primera historia de Comedor Los Pibes
    Y en el perfil de Comedor Los Pibes, un visitante sin cuenta no ve la primera historia
    Y en el panel de Comedor Los Pibes, la primera historia ya no figura
    Y queda registro de la primera historia de Comedor Los Pibes

  Escenario: Una organización solo ve y elimina sus propias historias en el panel
    Dado que Comedor Los Pibes publicó 1 historia
    Y que Comedor La Esperanza publicó 1 historia
    Cuando el responsable de Comedor Los Pibes intenta eliminar la primera historia de Comedor La Esperanza
    Entonces el sistema le responde que esa historia no existe
    Y en el panel de Comedor Los Pibes figura solo la primera historia de Comedor Los Pibes
    Y en el inicio, un visitante sin cuenta ve la primera historia de Comedor La Esperanza

  Escenario: Un visitante sin cuenta ve todas las historias y no se registran vistas
    Dado que Comedor Los Pibes publicó 2 historias
    Cuando un visitante sin cuenta mira la primera historia de Comedor Los Pibes en el inicio
    Entonces en el inicio, un visitante sin cuenta ve a Comedor Los Pibes con 2 historias sin ver
    Y no quedó registrada ninguna vista de las historias de Comedor Los Pibes

  Escenario: Solo se muestran historias de organizaciones validadas
    Dado que Comedor Los Pibes publicó 1 historia
    Y que Comedor La Esperanza publicó 1 historia
    Y que Comedor La Esperanza quedó pendiente de validación
    Entonces en el inicio, un visitante sin cuenta ve a Comedor Los Pibes con 1 historia sin ver
    Y en el inicio, un visitante sin cuenta no ve a Comedor La Esperanza
