# language: es
Característica: Top 10 donantes del mes en el inicio
  Como visitante quiero ver en el inicio quiénes son las personas que más
  donaron este mes, para reconocer a quienes sostienen a las organizaciones.

  El ranking suma, por persona con cuenta, las donaciones de dinero que las
  organizaciones ya confirmaron durante el mes calendario en curso (hora de
  Argentina), entre todas las organizaciones validadas. Las donaciones
  anónimas no figuran. Muestra posición, nombre y monto; nunca datos de
  contacto.

  Escenario: Un visitante sin cuenta ve a los que más donaron este mes
    Dado que se recibieron estas donaciones:
      | donante     | organización      | monto |
      | Ana Pérez   | Comedor Los Pibes | 3000  |
      | Beto Ruiz   | Comedor Los Pibes | 8000  |
      | Carla Gómez | Comedor Los Pibes | 5000  |
    Cuando un visitante sin cuenta entra al inicio
    Entonces ve el ranking de donantes del mes:
      | posición | donante     | monto |
      | 1        | Beto Ruiz   | 8000  |
      | 2        | Carla Gómez | 5000  |
      | 3        | Ana Pérez   | 3000  |
    Y el ranking no muestra el correo ni el contacto de nadie

  Escenario: Lo donado a distintas organizaciones se suma en una sola fila
    Dado que se recibieron estas donaciones:
      | donante   | organización         | monto |
      | Ana Pérez | Comedor Los Pibes    | 2000  |
      | Ana Pérez | Comedor La Esperanza | 3000  |
      | Beto Ruiz | Comedor Los Pibes    | 4000  |
    Cuando un visitante sin cuenta entra al inicio
    Entonces ve el ranking de donantes del mes:
      | posición | donante   | monto |
      | 1        | Ana Pérez | 5000  |
      | 2        | Beto Ruiz | 4000  |

  Escenario: Solo cuenta lo que la organización ya confirmó
    Dado que se recibieron estas donaciones:
      | donante   | organización      | monto | estado      |
      | Ana Pérez | Comedor Los Pibes | 2000  | confirmada  |
      | Ana Pérez | Comedor Los Pibes | 3000  | a confirmar |
    Cuando un visitante sin cuenta entra al inicio
    Entonces ve el ranking de donantes del mes:
      | posición | donante   | monto |
      | 1        | Ana Pérez | 2000  |
    Cuando "Comedor Los Pibes" confirma que recibió los $3000 de Ana Pérez
    Y un visitante sin cuenta vuelve a entrar al inicio
    Entonces ve el ranking de donantes del mes:
      | posición | donante   | monto |
      | 1        | Ana Pérez | 5000  |

  Escenario: Las donaciones anónimas no figuran ni se le suman a otro
    Dado que se recibieron estas donaciones:
      | donante   | organización      | monto | anónima |
      | Ana Pérez | Comedor Los Pibes | 3000  | no      |
      | Ana Pérez | Comedor Los Pibes | 7000  | sí      |
      | Beto Ruiz | Comedor Los Pibes | 9000  | sí      |
    Y que alguien sin cuenta donó $4000 a "Comedor Los Pibes" firmando como "Ana Pérez"
    Cuando un visitante sin cuenta entra al inicio
    Entonces ve el ranking de donantes del mes:
      | posición | donante   | monto |
      | 1        | Ana Pérez | 3000  |

  Escenario: El mes se corta en hora de Argentina
    Dado que se recibieron estas donaciones:
      | donante   | organización      | monto | fecha                                   |
      | Ana Pérez | Comedor Los Pibes | 5000  | último día del mes anterior a las 22:30 |
      | Ana Pérez | Comedor Los Pibes | 1000  | día 1 de este mes a las 22:30           |
      | Beto Ruiz | Comedor Los Pibes | 9000  | último día del mes anterior a las 22:30 |
    Cuando un visitante sin cuenta entra al inicio
    Entonces ve el ranking de donantes del mes:
      | posición | donante   | monto |
      | 1        | Ana Pérez | 1000  |

  Escenario: Ante un empate queda arriba quien llegó primero a ese monto
    Dado que se recibieron estas donaciones:
      | donante     | organización      | monto | fecha                         |
      | Ana Pérez   | Comedor Los Pibes | 5000  | día 1 de este mes a las 10:00 |
      | Beto Ruiz   | Comedor Los Pibes | 5000  | día 1 de este mes a las 09:00 |
      | Carla Gómez | Comedor Los Pibes | 5000  | día 1 de este mes a las 08:00 |
      | Bruno Díaz  | Comedor Los Pibes | 5000  | día 1 de este mes a las 08:00 |
    Cuando un visitante sin cuenta entra al inicio
    Entonces ve el ranking de donantes del mes:
      | posición | donante     | monto |
      | 1        | Bruno Díaz  | 5000  |
      | 2        | Carla Gómez | 5000  |
      | 3        | Beto Ruiz   | 5000  |
      | 4        | Ana Pérez   | 5000  |
    Y cada vez que vuelve a entrar ve el mismo orden

  Escenario: Un mes sin donaciones deja el ranking vacío
    Dado que se recibieron estas donaciones:
      | donante   | organización      | monto | fecha        |
      | Ana Pérez | Comedor Los Pibes | 5000  | mes anterior |
    Cuando un visitante sin cuenta entra al inicio
    Entonces el ranking de donantes del mes está vacío

  Escenario: Lo donado a una organización no validada no cuenta
    Dado que se recibieron estas donaciones:
      | donante   | organización       | monto |
      | Ana Pérez | Comedor Los Pibes  | 1000  |
      | Ana Pérez | Comedor En Trámite | 5000  |
    Y que "Comedor En Trámite" no está validada
    Cuando un visitante sin cuenta entra al inicio
    Entonces ve el ranking de donantes del mes:
      | posición | donante   | monto |
      | 1        | Ana Pérez | 1000  |

  Escenario: Con más de diez donantes se muestran solo los diez primeros
    Dado que 12 personas donaron este mes montos distintos a "Comedor Los Pibes"
    Cuando un visitante sin cuenta entra al inicio
    Entonces ve 10 donantes, del que más donó en adelante
