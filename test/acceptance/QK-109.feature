# language: es
Característica: Filtrado por localidad en el inicio
  Como visitante sin cuenta quiero filtrar las organizaciones del inicio por
  localidad para encontrar rápido a las que están cerca mío.

  Las localidades para elegir salen de las organizaciones validadas que ya la
  cargaron (QK-112): el visitante nunca elige una localidad que no da
  resultados.

  Antecedentes:
    Dado que existe una organización validada en "Villa María"
    Y que existe otra organización validada en "Río Cuarto"
    Y que existe una organización validada sin localidad

  Escenario: Filtrar por una localidad
    Cuando el visitante filtra el inicio por "Villa María"
    Entonces solo ve la organización de "Villa María"

  Escenario: Sin filtro se ven todas
    Cuando el visitante abre el inicio sin filtrar
    Entonces ve las tres organizaciones, también la que no tiene localidad

  Escenario: Solo se ofrecen localidades de organizaciones validadas
    Dado que existe una organización pendiente en "Tío Pujio"
    Cuando el visitante pide las localidades para filtrar
    Entonces se ofrecen "Villa María" y "Río Cuarto"
    Y no se ofrece "Tío Pujio"

  Escenario: El filtro se combina con la búsqueda
    Cuando el visitante filtra el inicio por "Villa María" y busca "Río"
    Entonces no ve ninguna de las organizaciones
