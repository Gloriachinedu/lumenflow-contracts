> **Nota:** Este documento es una traducción al español de [`SECURITY.md`](SECURITY.md).  
> En caso de discrepancia, la versión oficial en inglés es la que prevalece.

# Política de Seguridad

## Versiones Compatibles

| Versión | Compatible |
|---------|-----------|
| 1.x     | ✅        |

## Cómo Reportar una Vulnerabilidad

**No abras un issue público en GitHub para reportar vulnerabilidades de seguridad.**

Por favor, reporta los problemas de seguridad enviando un correo electrónico a **security@lumenflow.dev** con:

1. Una descripción de la vulnerabilidad y su posible impacto.
2. Pasos para reproducirla o una prueba de concepto.
3. Posibles mitigaciones sugeridas.
4. Tu información de contacto y preferencias sobre divulgación.

### Reporte Seguro

- Para reportes cifrados, utiliza OpenPGP. Solicita nuestra clave pública o huella digital enviando un correo a **security@lumenflow.dev** antes de enviar información sensible.
- Si no puedes utilizar PGP, contáctanos y te proporcionaremos un canal alternativo seguro.

## Plazos de Respuesta

Acusaremos recibo de los reportes válidos en un plazo máximo de **48 horas**.

Plazos de respuesta por severidad:

| Severidad | Acuse de Recibo | Plan de Corrección / Mitigación | Divulgación Pública |
|-----------|-----------------|----------------------------------|---------------------|
| Crítica   | 48 horas        | 7 días                           | Dentro de 30 días tras la corrección |
| Alta      | 48 horas        | 14 días                          | Dentro de 45 días tras la corrección |
| Media     | 48 horas        | 30 días                          | Dentro de 60 días tras la corrección |
| Baja      | 48 horas        | 60 días                          | Dentro de 90 días tras la corrección |

Proporcionaremos actualizaciones de estado al menos cada **7 días** hasta que el problema quede resuelto.

## Alcance

En alcance:
- Vulnerabilidades en la lógica del contrato inteligente (reentrada, desbordamiento, evasión de autenticación)
- Debilidades en la verificación de firmas
- Manipulación del almacenamiento o corrupción de datos
- Vectores de denegación de servicio en la ejecución del contrato

Fuera de alcance:
- Problemas en dependencias de terceros (repórtalos directamente al proyecto correspondiente)
- Ataques teóricos sin una ruta de explotación práctica

## Política de Divulgación

Seguimos la divulgación coordinada. Una vez publicada la corrección, publicaremos un aviso de seguridad acreditando al reportador (salvo que solicite anonimato).

## Programa de Recompensas por Errores (Bug Bounty)

Disponemos de un programa de recompensas para reportes elegibles. Las recompensas se otorgan a discreción según la severidad, el impacto y la calidad del reporte. Para participar, envía un reporte válido a **security@lumenflow.dev** e incluye todos los detalles necesarios para reproducir el problema.

## Salón de la Fama

Con el consentimiento del reportador, reconoceremos las divulgaciones aceptadas en los avisos de seguridad publicados y mantendremos un Salón de la Fama para los colaboradores reconocidos.
