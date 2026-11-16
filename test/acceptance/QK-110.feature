# language: es
Característica: Perfil público del donante
  Como visitante quiero entrar al perfil de una persona del ranking de
  donantes para conocer cuánto viene aportando y desde cuándo.

  El perfil muestra el nombre, desde cuándo es donante (mes y año en que creó
  su cuenta), lo que donó en el mes en curso y lo que donó en total. Solo suma
  lo confirmado, a la vista, a organizaciones validadas. Nunca muestra correo,
  teléfono ni a qué organizaciones donó.

  Escenario: Un visitante sin cuenta entra al perfil de un donante del ranking
    Dado que Ana Pérez tiene cuenta desde marzo de 2025
    Y que se recibieron estas donaciones:
      | donante   | organización         | monto | fecha        |
      | Ana Pérez | Comedor Los Pibes    | 3000  |              |
      | Ana Pérez | Comedor La Esperanza | 2000  | mes anterior |
    Cuando un visitante sin cuenta entra al perfil de Ana Pérez desde el ranking del inicio
    Entonces ve que se llama "Ana Pérez" y que es donante desde marzo de 2025
    Y ve que este mes donó $3000 y en total $5000

  Escenario: El perfil no muestra datos de contacto ni a qué organizaciones donó
    Dado que se recibieron estas donaciones:
      | donante   | organización      | monto |
      | Ana Pérez | Comedor Los Pibes | 3000  |
    Y que Ana Pérez tiene cargado el teléfono "353 444-5566" en su cuenta
    Cuando un visitante sin cuenta entra al perfil de Ana Pérez
    Entonces no ve su correo, ni su teléfono, ni las organizaciones a las que donó

  Escenario: Solo suma lo confirmado, a la vista y a organizaciones validadas
    Dado que se recibieron estas donaciones:
      | donante   | organización       | monto | estado      | anónima |
      | Ana Pérez | Comedor Los Pibes  | 1000  | confirmada  | no      |
      | Ana Pérez | Comedor Los Pibes  | 2000  | confirmada  | sí      |
      | Ana Pérez | Comedor Los Pibes  | 3000  | a confirmar | no      |
      | Ana Pérez | Comedor Los Pibes  | 4000  | rechazada   | no      |
      | Ana Pérez | Comedor En Trámite | 5000  | confirmada  | no      |
    Y que "Comedor En Trámite" no está validada
    Cuando un visitante sin cuenta entra al perfil de Ana Pérez
    Entonces ve que este mes donó $1000 y en total $1000

  Escenario: Una cuenta sin donaciones públicas confirmadas no tiene perfil
    Dado que se recibieron estas donaciones:
      | donante   | organización      | monto | estado      | anónima |
      | Ana Pérez | Comedor Los Pibes | 2000  | confirmada  | sí      |
      | Ana Pérez | Comedor Los Pibes | 3000  | a confirmar | no      |
    Cuando un visitante sin cuenta entra al perfil de Ana Pérez
    Entonces el perfil no existe
