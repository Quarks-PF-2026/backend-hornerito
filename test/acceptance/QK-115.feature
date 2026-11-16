# language: es
Característica: Top donantes del mes en la ficha de la organización
  Como visitante quiero ver en la ficha de una organización quiénes son las
  personas que más le donaron este mes, para reconocer a quienes la sostienen.

  Es el mismo criterio que el ranking del inicio, recortado a una sola
  organización: suma por persona con cuenta lo que esa organización ya
  confirmó en el mes en curso, sin anónimas, y muestra hasta cinco. Una
  organización que no tiene cargados sus datos para recibir donaciones no
  muestra el top.

  Escenario: La ficha muestra a los que más le donaron este mes
    Dado que se recibieron estas donaciones:
      | donante     | organización      | monto |
      | Ana Pérez   | Comedor Los Pibes | 3000  |
      | Beto Ruiz   | Comedor Los Pibes | 8000  |
      | Carla Gómez | Comedor Los Pibes | 5000  |
    Cuando un visitante sin cuenta entra a la ficha de "Comedor Los Pibes"
    Entonces ve los donantes del mes de la organización:
      | posición | donante     | monto |
      | 1        | Beto Ruiz   | 8000  |
      | 2        | Carla Gómez | 5000  |
      | 3        | Ana Pérez   | 3000  |

  Escenario: Cada ficha cuenta solo lo donado a esa organización
    Dado que se recibieron estas donaciones:
      | donante   | organización         | monto |
      | Ana Pérez | Comedor Los Pibes    | 2000  |
      | Ana Pérez | Comedor La Esperanza | 9000  |
      | Beto Ruiz | Comedor Los Pibes    | 4000  |
    Cuando un visitante sin cuenta entra a la ficha de "Comedor Los Pibes"
    Entonces ve los donantes del mes de la organización:
      | posición | donante   | monto |
      | 1        | Beto Ruiz | 4000  |
      | 2        | Ana Pérez | 2000  |

  Escenario: Con más de cinco donantes se muestran solo los cinco primeros
    Dado que 7 personas donaron este mes montos distintos a "Comedor Los Pibes"
    Cuando un visitante sin cuenta entra a la ficha de "Comedor Los Pibes"
    Entonces ve 5 donantes, del que más donó en adelante

  Escenario: Las donaciones anónimas y las que falta confirmar no aparecen
    Dado que se recibieron estas donaciones:
      | donante     | organización      | monto | estado      | anónima |
      | Ana Pérez   | Comedor Los Pibes | 1000  | confirmada  | no      |
      | Ana Pérez   | Comedor Los Pibes | 7000  | confirmada  | sí      |
      | Beto Ruiz   | Comedor Los Pibes | 9000  | confirmada  | sí      |
      | Carla Gómez | Comedor Los Pibes | 8000  | a confirmar | no      |
    Cuando un visitante sin cuenta entra a la ficha de "Comedor Los Pibes"
    Entonces ve los donantes del mes de la organización:
      | posición | donante   | monto |
      | 1        | Ana Pérez | 1000  |

  Escenario: Sin donaciones este mes la sección queda vacía
    Dado que se recibieron estas donaciones:
      | donante   | organización      | monto | fecha        |
      | Ana Pérez | Comedor Los Pibes | 5000  | mes anterior |
    Cuando un visitante sin cuenta entra a la ficha de "Comedor Los Pibes"
    Entonces la ficha no muestra donantes del mes

  Escenario: Una organización sin datos para recibir donaciones no muestra el top
    Dado que se recibieron estas donaciones:
      | donante   | organización      | monto |
      | Ana Pérez | Comedor Los Pibes | 5000  |
    Y que "Comedor Los Pibes" ya no tiene cargados sus datos para recibir donaciones
    Cuando un visitante sin cuenta entra a la ficha de "Comedor Los Pibes"
    Entonces la ficha no muestra donantes del mes

  Escenario: Cada organización muestra solo a sus propios donantes
    Dado que se recibieron estas donaciones:
      | donante   | organización         | monto |
      | Ana Pérez | Comedor Los Pibes    | 3000  |
      | Beto Ruiz | Comedor La Esperanza | 6000  |
    Cuando un visitante sin cuenta entra a la ficha de "Comedor Los Pibes"
    Entonces ve los donantes del mes de la organización:
      | posición | donante   | monto |
      | 1        | Ana Pérez | 3000  |
    Cuando un visitante sin cuenta entra a la ficha de "Comedor La Esperanza"
    Entonces ve los donantes del mes de la organización:
      | posición | donante   | monto |
      | 1        | Beto Ruiz | 6000  |
