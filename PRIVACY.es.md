# Política de Privacidad — LumenFlow

**Fecha de entrada en vigor:** 2026-07-25  
**Última actualización:** 2026-07-25

LumenFlow es un protocolo de procesamiento de pagos descentralizado construido sobre el blockchain [Stellar Soroban](https://soroban.stellar.org). Esta Política de Privacidad explica qué datos personales se procesan a través de los contratos inteligentes de LumenFlow, cómo se gestionan y los derechos disponibles para los interesados bajo el Reglamento General de Protección de Datos (GDPR) y las leyes de privacidad equivalentes.

---

## 1. Responsable del Tratamiento

LumenFlow es un protocolo de código abierto. La entidad que opera un despliegue específico de los contratos inteligentes de LumenFlow es el responsable del tratamiento para ese despliegue. Si no está seguro de quién opera el despliegue con el que interactúa, contacte con la plataforma o aplicación que utilizó para acceder a LumenFlow.

Para preguntas sobre esta política o para ejercer sus derechos, contacte con:

- **Correo electrónico:** privacy@lumenflow.example.com  
- **Incidencias en GitHub:** https://github.com/Gloriachinedu/lumenflow-contracts/issues (use la etiqueta `privacy`)

---

## 2. Qué Datos Se Almacenan

El contrato inteligente de LumenFlow almacena las siguientes categorías de datos en la cadena como parte de los perfiles de los comercios:

| Campo | Descripción | Categoría |
|-------|-------------|-----------|
| `address` | Clave pública Stellar (dirección de billetera) | Identificador seudonimizado |
| `name` | Nombre visible del comercio | Potencialmente personal (para autónomos) |
| `description` | Descripción en texto libre del negocio del comercio | Potencialmente personal |
| `contact_info` | Datos de contacto (correo electrónico, URL, etc.) | Potencialmente personal |
| `category` | Categoría del negocio | No personal |
| `active` | Si la cuenta del comercio está activa | No personal |
| `verified` | Si el comercio ha sido verificado | No personal |
| `registered_at` | Marca de tiempo del registro del comercio | No personal |
| `total_received` | Volumen acumulado de pagos recibidos | No personal |

Los registros de pago también almacenan:

| Campo | Descripción | Categoría |
|-------|-------------|-----------|
| `payer` | Clave pública Stellar del pagador | Identificador seudonimizado |
| `merchant_address` | Clave pública Stellar del comercio | Identificador seudonimizado |
| `amount` | Importe del pago | No personal |
| `paid_at` | Marca de tiempo del pago | No personal |
| `memo` | Nota de pago opcional (proporcionada por el usuario) | Potencialmente personal |

> **Aviso de inmutabilidad del blockchain:** Los registros de pago se almacenan en el blockchain Stellar. Una vez confirmados, los datos de transacción (incluidos los registros de eventos en cadena) no pueden eliminarse. Sin embargo, los campos del perfil del comercio (`name`, `description`, `contact_info`) que pueden contener datos personales **sí pueden** anonimizarse mediante el procedimiento de eliminación de datos descrito en la Sección 5.

---

## 3. Base Legal del Tratamiento

LumenFlow trata los datos anteriores sobre las siguientes bases legales según el Artículo 6 del GDPR:

- **Ejecución de contrato (Art. 6(1)(b)):** El tratamiento es necesario para registrar e identificar a los comercios y para ejecutar transacciones de pago.
- **Intereses legítimos (Art. 6(1)(f)):** Mantenimiento del historial de pagos y estadísticas globales para la prevención del fraude, la resolución de disputas y la integridad del sistema.
- **Obligación legal (Art. 6(1)(c)):** Conservación de los registros de transacciones durante el período requerido por la normativa financiera aplicable.

---

## 4. Conservación de Datos

| Tipo de dato | Período de conservación | Base |
|--------------|------------------------|------|
| Perfil del comercio (campos de datos personales) | Hasta que se solicite y confirme la eliminación | Ejecución de contrato |
| Registros de pago (en cadena) | Indefinido (inmutabilidad del blockchain) | Intereses legítimos / obligación legal |
| Registros de pago (almacenamiento del contrato) | Período de limpieza configurable (predeterminado: 90 días) | Discreción del administrador |
| Registros de eventos (Horizon/archivo) | Sujeto a la política de archivo de la red Stellar | Stellar Foundation |

Los administradores pueden configurar un período de limpieza de pagos más corto mediante `set_payment_cleanup_period` y eliminar registros obsoletos con `cleanup_expired_payments`.

---

## 5. Derecho de Supresión (Derecho al Olvido)

En virtud del Artículo 17 del GDPR, los interesados tienen derecho a solicitar la supresión de sus datos personales. LumenFlow implementa este derecho a través de la función de contrato `request_merchant_data_deletion`.

### Qué ocurre cuando solicita la eliminación

Cuando se confirma una solicitud de eliminación, los siguientes campos de datos personales del perfil del comercio en la cadena se reemplazan con el valor de marcador de posición `[deleted]`:

- `name` → `[deleted]`
- `description` → `[deleted]`
- `contact_info` → `[deleted]`

La clave pública Stellar del comercio (`address`) se conserva como referencia seudonimizada para preservar la integridad de los registros de pago existentes. Los importes de pago, las marcas de tiempo y otros campos no personales de los registros de pago también se conservan con fines de mantenimiento de registros financieros.

Se emite un evento `lumenflow/merchant_data_deleted` en cadena cuando se completa la eliminación.

### Limitaciones

Debido a la naturaleza inmutable del blockchain Stellar:

- Los **registros de eventos** en cadena y el **historial de transacciones** registrado por los nodos Stellar Horizon están fuera del control de LumenFlow y no pueden eliminarse.
- Las **copias fuera de la cadena** de datos (copias de seguridad, sistemas de análisis, integraciones de terceros) deben ser gestionadas por separado por el operador de la plataforma.

### Cómo solicitar la eliminación

Consulte [docs/merchant-onboarding.md — Eliminación de datos](docs/merchant-onboarding.md#data-deletion) para obtener instrucciones paso a paso.

---

## 6. Otros Derechos de los Interesados

En virtud del GDPR y las leyes equivalentes, usted tiene los siguientes derechos:

| Derecho | Cómo ejercerlo |
|---------|----------------|
| **Acceso (Art. 15)** | Llame a `get_merchant(merchant_address)` para recuperar su perfil almacenado. |
| **Rectificación (Art. 16)** | Llame a `update_merchant` para corregir información inexacta. |
| **Supresión (Art. 17)** | Siga el [procedimiento de eliminación de datos](docs/merchant-onboarding.md#data-deletion). |
| **Limitación (Art. 18)** | Contacte con privacy@lumenflow.example.com para tratar la limitación del tratamiento. |
| **Portabilidad (Art. 20)** | Su perfil e historial de pagos son accesibles a través de las funciones de consulta pública del contrato. |
| **Oposición (Art. 21)** | Contacte con privacy@lumenflow.example.com. Tenga en cuenta que determinados tratamientos son necesarios para la ejecución del contrato. |

Para ejercer cualquiera de estos derechos, envíe un correo electrónico a **privacy@lumenflow.example.com** o abra una incidencia en GitHub con la etiqueta `privacy`.

---

## 7. Datos de Menores

Los servicios de LumenFlow están destinados a empresas y personas mayores de 18 años. No recopilamos ni tratamos conscientemente datos personales de menores de 16 años (o la edad mínima aplicable en la jurisdicción correspondiente). Si cree que un menor ha registrado un perfil de comercio, contacte con **privacy@lumenflow.example.com** y tomaremos las medidas adecuadas para eliminar los datos.

---

## 8. Transferencias Internacionales de Datos

Los datos del blockchain Stellar se replican en una red de validadores distribuida globalmente. Al interactuar con el contrato inteligente de LumenFlow, usted reconoce que los datos almacenados en la cadena pueden replicarse en nodos de jurisdicciones fuera del Espacio Económico Europeo. La red Stellar no proporciona cláusulas contractuales estándar ni una decisión de adecuación. Los operadores de despliegue que dependan de infraestructura fuera de la cadena deben asegurarse de que existen mecanismos de transferencia adecuados.

---

## 9. Seguridad

LumenFlow utiliza las siguientes medidas técnicas para proteger los datos:

- Todas las funciones que modifican el estado requieren autorización criptográfica de la dirección correspondiente (comercio, pagador o administrador).
- El contrato puede ser pausado por un administrador en respuesta a un incidente de seguridad.
- Las actualizaciones del perfil del comercio requieren la firma del propio comercio, lo que impide modificaciones no autorizadas.
- Las solicitudes de eliminación requieren confirmación del administrador en un plazo de 30 días.

Para la divulgación responsable de vulnerabilidades de seguridad, consulte [SECURITY.md](SECURITY.md).

---

## 10. Cookies y Seguimiento

El contrato inteligente de LumenFlow en sí mismo no utiliza cookies ni tecnologías de seguimiento. Las aplicaciones front-end construidas sobre LumenFlow pueden utilizar cookies o análisis; consulte las políticas de privacidad de esas aplicaciones para obtener más detalles.

---

## 11. Cambios en Esta Política

Podemos actualizar esta política de vez en cuando. Los cambios materiales se anunciarán a través del [repositorio de GitHub](https://github.com/Gloriachinedu/lumenflow-contracts) y se indicarán en [CHANGELOG.md](CHANGELOG.md). La fecha de "Última actualización" en la parte superior de este documento indica cuándo se revisó la política por última vez.

---

## 12. Contacto

Para todas las consultas relacionadas con la privacidad:

- **Correo electrónico:** privacy@lumenflow.example.com  
- **GitHub:** https://github.com/Gloriachinedu/lumenflow-contracts/issues (etiqueta `privacy`)
- **Discord:** https://discord.gg/lumenflow
