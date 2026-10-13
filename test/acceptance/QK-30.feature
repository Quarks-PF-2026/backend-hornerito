# language: es
Característica: Predecir asistencia de eventos periódicos
  Como persona que coordina la organización quiero ver cuánta gente se espera
  en los próximos días para cada evento periódico, a partir de la asistencia
  que ya se registró, para anticipar cuántos insumos hacen falta.

  Como persona que coordina la organización también quiero que el sistema me
  sugiera qué insumos volver a pedir, según lo que la organización necesitó en
  los últimos 90 días, para no olvidarme de pedirlos.

  # Una sugerencia es un insumo activo con al menos una necesidad creada en los
  # últimos 90 días (cerrada o no) y ninguna necesidad abierta hoy. Se muestran
  # hasta 3: primero los más pedidos y, en empate, el pedido más reciente.
  # Aceptar (prellenar el formulario con el insumo) o descartar el aviso es
  # comportamiento de pantalla y se prueba en el front; acá se verifica que la
  # sugerencia trae lo necesario para prellenar.

  Antecedentes:
    Dado que existe una organización con su responsable

  Escenario: Proyección con historial suficiente y asistencia creciente
    Dado que existe el evento periódico "Almuerzo diario" con asistencia desde 10 personas que crece 2 por día durante 40 días
    Cuando el responsable consulta la asistencia proyectada
    Entonces ve el evento "Almuerzo diario" con 40 días de asistencia registrada
    Y la tendencia es "sube"
    Y ve la cantidad estimada de personas para cada uno de los próximos 7 días
    Y la estimación para mañana es de 90 personas y crece 2 por día

  Escenario: Proyección con asistencia estable
    Dado que existe el evento periódico "Almuerzo diario" con asistencia constante de 20 personas durante 35 días
    Cuando el responsable consulta la asistencia proyectada
    Entonces la tendencia es "estable"
    Y ve la cantidad estimada de personas para cada uno de los próximos 7 días
    Y la estimación para mañana es de 20 personas y crece 0 por día

  Escenario: Historial insuficiente
    Dado que existe el evento periódico "Almuerzo diario" con asistencia constante de 20 personas durante 10 días
    Cuando el responsable consulta la asistencia proyectada
    Entonces no se muestra proyección para el evento "Almuerzo diario"
    Y se informa que faltan registros para llegar a 30 días

  Escenario: Los eventos extraordinarios no tienen proyección
    Dado que existe el evento extraordinario "Colecta de invierno"
    Cuando el responsable consulta la asistencia proyectada
    Entonces no aparece ningún evento en la proyección

  Escenario: Una organización no ve la proyección de otra
    Dado que existe el evento periódico "Almuerzo diario" con asistencia desde 10 personas que crece 2 por día durante 40 días
    Y que existe otra organización con su propio responsable y su propio evento periódico "Ropero comunitario" con asistencia constante de 5 personas durante 10 días
    Cuando el responsable consulta la asistencia proyectada
    Entonces solo ve el evento "Almuerzo diario" en la proyección

  Escenario: Se sugieren hasta 3 insumos, los más pedidos primero
    Dado que existe el insumo "Arroz" con 4 necesidades cerradas, la última hace 10 días
    Y que existe el insumo "Fideos" con 3 necesidades cerradas, la última hace 8 días
    Y que existe el insumo "Aceite" con 3 necesidades cerradas, la última hace 5 días
    Y que existe el insumo "Harina" con 2 necesidades cerradas, la última hace 3 días
    Y que existe el insumo "Azúcar" con 1 necesidad cerrada, la última hace 2 días
    Cuando el responsable consulta las sugerencias de nuevas necesidades
    Entonces se sugieren los insumos "Arroz, Aceite, Fideos" en ese orden
    Y "Arroz" figura como pedido 4 veces
    Y cada sugerencia trae el insumo para prellenar la nueva necesidad

  Escenario: Sin historial de necesidades no hay sugerencias
    Dado que existe el insumo "Arroz" sin ninguna necesidad
    Cuando el responsable consulta las sugerencias de nuevas necesidades
    Entonces no se sugiere ningún insumo

  Escenario: Un insumo con una necesidad abierta no se sugiere
    Dado que existe el insumo "Arroz" con 2 necesidades cerradas, la última hace 10 días
    Y que existe el insumo "Fideos" con 2 necesidades cerradas, la última hace 10 días
    Y que el insumo "Arroz" tiene además una necesidad abierta
    Cuando el responsable consulta las sugerencias de nuevas necesidades
    Entonces solo se sugiere el insumo "Fideos"

  Escenario: Las necesidades de hace más de 90 días no cuentan
    Dado que existe el insumo "Arroz" con 2 necesidades cerradas, la última hace 100 días
    Y que existe el insumo "Fideos" con 1 necesidad cerrada, la última hace 80 días
    Cuando el responsable consulta las sugerencias de nuevas necesidades
    Entonces solo se sugiere el insumo "Fideos"

  Escenario: Una organización no recibe sugerencias basadas en datos de otra
    Dado que existe el insumo "Arroz" con 4 necesidades cerradas, la última hace 10 días
    Y que existe otra organización con su propio responsable y su propio insumo "Fideos" con 2 necesidades cerradas, la última hace 5 días
    Cuando el responsable consulta las sugerencias de nuevas necesidades
    Entonces solo se sugiere el insumo "Arroz"
