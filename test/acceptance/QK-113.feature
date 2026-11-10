# language: es
Característica: Donar con la sesión iniciada
  Como donante con cuenta quiero que las donaciones que hago con la sesión
  iniciada queden asociadas a mi cuenta, para que sumen en mi perfil y en los
  rankings de donantes.

  Donar sin sesión sigue funcionando igual que siempre. Una sesión vencida o
  inválida no impide donar: la donación se toma como la de un visitante. Una
  donación anónima queda asociada a la cuenta, la organización ve quién la
  hizo, pero el nombre no aparece en ningún lugar público.

  En "Mis donaciones" cada donante ve su historial privado: todas las que hizo
  con la sesión iniciada, incluidas las anónimas, las pendientes y las
  rechazadas. Nunca ve las de otro donante.

  Antecedentes:
    Dado que "Comedor Los Pibes" recibe donaciones por transferencia
    Y que Ana Pérez tiene cuenta y la sesión iniciada

  Escenario: Donar con la sesión iniciada asocia la donación a la cuenta
    Cuando Ana Pérez declara una donación de $5000 a "Comedor Los Pibes"
    Entonces la donación queda registrada
    Y queda asociada a la cuenta de Ana Pérez

  Escenario: Donar sin sesión sigue funcionando como siempre
    Cuando un visitante sin sesión declara una donación de $5000 a "Comedor Los Pibes"
    Entonces la donación queda registrada
    Y no queda asociada a ninguna cuenta

  Escenario: Una donación anónima queda en la cuenta pero no se muestra en público
    Cuando Ana Pérez declara una donación anónima de $5000 a "Comedor Los Pibes" firmando "Ana Pérez" con contacto "ana.perez@correo.test"
    Entonces la donación queda registrada
    Y queda asociada a la cuenta de Ana Pérez como anónima
    Y "Comedor Los Pibes" ve en su panel el nombre "Ana Pérez" y el contacto "ana.perez@correo.test"
    Cuando "Comedor Los Pibes" confirma que la recibió
    Entonces Ana Pérez no figura en el ranking de donantes del mes del inicio

  Escenario: El nombre y el contacto que edita el donante quedan en la donación, no en su cuenta
    Cuando Ana Pérez declara una donación de $5000 a "Comedor Los Pibes" firmando "Familia Pérez" con contacto "familia.perez@correo.test"
    Entonces la donación queda registrada
    Y queda asociada a la cuenta de Ana Pérez
    Y "Comedor Los Pibes" ve en su panel el nombre "Familia Pérez" y el contacto "familia.perez@correo.test"
    Y la cuenta de Ana Pérez conserva su nombre y su correo

  Escenario: Una donación sin sesión no se asocia a una cuenta aunque coincidan nombre y correo
    Cuando un visitante sin sesión declara una donación de $5000 a "Comedor Los Pibes" firmando con el nombre y el correo de la cuenta de Ana Pérez
    Entonces la donación queda registrada
    Y no queda asociada a ninguna cuenta

  Escenario: Cada organización ve en su panel solo la donación que recibió
    Dado que "Comedor La Esperanza" también recibe donaciones por transferencia
    Cuando Ana Pérez declara una donación de $5000 a "Comedor Los Pibes"
    Y Ana Pérez declara una donación de $3000 a "Comedor La Esperanza"
    Entonces "Comedor Los Pibes" ve en su panel solo la donación de $5000
    Y "Comedor La Esperanza" ve en su panel solo la donación de $3000
    Y las dos donaciones quedan asociadas a la cuenta de Ana Pérez

  Escenario: Con la sesión vencida se dona como visitante
    Dado que la sesión de Ana Pérez está vencida
    Cuando Ana Pérez declara una donación de $5000 a "Comedor Los Pibes"
    Entonces la donación queda registrada
    Y no queda asociada a ninguna cuenta

  Escenario: Con una sesión inválida se dona como visitante
    Dado que la sesión de Ana Pérez no es válida
    Cuando Ana Pérez declara una donación de $5000 a "Comedor Los Pibes"
    Entonces la donación queda registrada
    Y no queda asociada a ninguna cuenta

  Escenario: El donante ve su historial en "Mis donaciones"
    Dado que "Comedor La Esperanza" también recibe donaciones por transferencia
    Y que Ana Pérez declaró una donación de $5000 a "Comedor Los Pibes"
    Y que "Comedor Los Pibes" confirmó que la recibió
    Y que Ana Pérez declaró una donación anónima de $3000 a "Comedor La Esperanza"
    Y que un visitante sin sesión declaró una donación de $700 a "Comedor Los Pibes"
    Cuando Ana Pérez entra a "Mis donaciones"
    Entonces ve en su historial, de la más nueva a la más vieja:
      | organización         | monto | estado      | anónima |
      | Comedor La Esperanza | 3000  | a confirmar | sí      |
      | Comedor Los Pibes    | 5000  | confirmada  | no      |

  Escenario: Cada donante ve solo sus propias donaciones
    Dado que Bruno Díaz también tiene cuenta y la sesión iniciada
    Y que Ana Pérez declaró una donación de $5000 a "Comedor Los Pibes"
    Y que Bruno Díaz declaró una donación de $2000 a "Comedor Los Pibes"
    Cuando Ana Pérez entra a "Mis donaciones"
    Entonces ve en su historial solo la donación de $5000
    Cuando Bruno Díaz entra a "Mis donaciones"
    Entonces ve en su historial solo la donación de $2000

  Escenario: Sin sesión no se puede ver ningún historial de donaciones
    Dado que Ana Pérez declaró una donación de $5000 a "Comedor Los Pibes"
    Cuando un visitante sin sesión intenta entrar a "Mis donaciones"
    Entonces el sistema le pide iniciar sesión
