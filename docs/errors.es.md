> **Nota:** Este documento es una traducción al español de [`errors.md`](errors.md).  
> En caso de discrepancia, la versión oficial en inglés es la que prevalece.

# Códigos de Error del Contrato LumenFlow

Este documento enumera todos los códigos de error devueltos por el contrato LumenFlow, junto con sus descripciones y los pasos de remediación sugeridos.

## Errores de Autenticación

| Nombre del Error | Código | Descripción | Remediación |
| :--- | :--- | :--- | :--- |
| `Unauthorized` | 1 | El emisor de la llamada no está autorizado para realizar esta acción. | Asegúrese de que el emisor haya firmado la transacción y tenga el rol requerido (p. ej., administrador, comercio). |
| `AdminAlreadySet` | 2 | El administrador del contrato ya ha sido inicializado. | La inicialización del administrador solo puede realizarse una vez. |
| `InvalidAdminAddress` | 3 | La dirección de administrador proporcionada no es válida. | Asegúrese de pasar una dirección Stellar válida. |
| `InvalidNonce` | 4 | El nonce proporcionado no coincide con el valor esperado. | Obtenga el nonce actual e increméntelo en 1. |

## Errores de Comercio

| Nombre del Error | Código | Descripción | Remediación |
| :--- | :--- | :--- | :--- |
| `MerchantNotFound` | 10 | El perfil de comercio solicitado no existe. | Verifique la dirección del comercio y asegúrese de que esté registrado. |
| `MerchantAlreadyRegistered` | 11 | Ya existe un perfil de comercio para la dirección indicada. | Utilice el perfil existente o regístrese con una dirección diferente. |
| `MerchantInactive` | 12 | El perfil del comercio está desactivado. | Un administrador debe reactivar el perfil del comercio para reanudar las operaciones. |

## Errores de Pago

| Nombre del Error | Código | Descripción | Remediación |
| :--- | :--- | :--- | :--- |
| `PaymentNotFound` | 20 | El pago especificado no fue encontrado. | Verifique el ID de pago o el ID de pedido. |
| `PaymentAlreadyExists` | 21 | Ya existe un pago con el ID de pedido indicado. | Utilice un ID de pedido único para cada pago. |
| `InvalidAmount` | 22 | El monto del pago es cero o negativo. | Proporcione un monto positivo y distinto de cero. |
| `InvalidSignature` | 23 | La firma Ed25519 proporcionada no es válida o no corresponde al payload. | Asegúrese de que el payload esté correctamente construido y firmado con la clave privada correcta. |
| `PaymentExpired` | 24 | La solicitud de pago ha expirado. | Cree una nueva solicitud de pago. |
| `InsufficientBalance` | 25 | El pagador no tiene suficientes tokens para completar el pago. | Asegúrese de que el pagador tenga fondos suficientes en el token especificado. |
| `TokenNotAllowed` | 26 | El token especificado no está aceptado. | Utilice un token compatible. |

## Errores de Reembolso

| Nombre del Error | Código | Descripción | Remediación |
| :--- | :--- | :--- | :--- |
| `RefundNotFound` | 30 | El reembolso solicitado no fue encontrado. | Verifique el ID de reembolso. |
| `RefundAlreadyExists` | 31 | Ya existe un reembolso con el ID indicado. | Utilice un ID de reembolso único. |
| `RefundWindowExpired` | 32 | El período permitido para iniciar un reembolso ha expirado. | Los reembolsos deben iniciarse dentro de los 30 días posteriores al pago. |
| `RefundExceedsOriginal` | 33 | El monto total del reembolso supera el monto del pago original. | Asegúrese de que el monto del reembolso (o los reembolsos parciales acumulados) no supere el pago original. |
| `RefundNotApproved` | 34 | El reembolso aún no ha sido aprobado. | El comercio o el administrador debe aprobar el reembolso antes de que pueda ejecutarse. |
| `RefundAlreadyCompleted` | 35 | El reembolso ya ha sido ejecutado. | No se requiere ninguna acción; el reembolso está completo. |
| `TooManyRefunds` | 36 | Se ha alcanzado el número máximo de reembolsos parciales para un solo pago. | Consolide los montos de reembolso o resuélvalo fuera del contrato. |
| `RefundNotRejected` | 37 | El reembolso no puede ser disputado porque no fue rechazado. | Solo los reembolsos rechazados pueden ser disputados. |
| `DisputeAlreadyExists` | 38 | Ya existe una disputa para este reembolso. | Verifique el estado de la disputa existente. |
| `DisputeNotFound` | 39 | La disputa solicitada no fue encontrada. | Verifique el ID de reembolso. |

## Errores de Firma Múltiple (Multisig)

| Nombre del Error | Código | Descripción | Remediación |
| :--- | :--- | :--- | :--- |
| `MultisigNotFound` | 40 | La solicitud de pago con firma múltiple no fue encontrada. | Verifique el ID de pago. |
| `MultisigAlreadySigned` | 41 | El emisor ya firmó este pago con firma múltiple. | Espere a que firmen los demás firmantes requeridos. |
| `MultisigAlreadyExecuted` | 42 | El pago con firma múltiple ya fue ejecutado. | No se requiere ninguna acción. |
| `InsufficientSignatures` | 43 | El pago con firma múltiple no cuenta con el número requerido de firmas para ejecutarse. | Obtenga más firmas de los firmantes autorizados. |

## Errores Generales

| Nombre del Error | Código | Descripción | Remediación |
| :--- | :--- | :--- | :--- |
| `InvalidInput` | 50 | Los parámetros de entrada proporcionados no son válidos. | Verifique los valores y el formato de los parámetros. |
| `PaginationLimitExceeded` | 51 | El límite solicitado para la paginación supera el máximo permitido (100). | Utilice un límite de 100 o menos. |
| `BatchSizeExceeded` | 52 | La operación por lotes supera el número máximo de elementos permitidos. | Reduzca el número de elementos en el lote. |
| `InvalidTags` | 53 | Las etiquetas proporcionadas superan los límites de longitud o cantidad. | Asegúrese de que las etiquetas estén dentro de los límites permitidos (p. ej., máximo 5 etiquetas, máximo 20 caracteres por etiqueta). |

## Errores de Suscripción

| Nombre del Error | Código | Descripción | Remediación |
| :--- | :--- | :--- | :--- |
| `SubscriptionPlanAlreadyExists` | 60 | Ya existe un plan de suscripción con el ID indicado. | Utilice un ID de plan único. |
| `SubscriptionAlreadyExists` | 61 | Ya existe una suscripción con el ID indicado. | Utilice un ID de suscripción único. |
| `SubscriptionPlanNotFound` | 62 | El plan de suscripción solicitado no fue encontrado. | Verifique el ID del plan. |
| `SubscriptionNotFound` | 63 | La suscripción solicitada no fue encontrada. | Verifique el ID de la suscripción. |
| `SubscriptionNotActive` | 64 | La suscripción no está activa. | Asegúrese de que la suscripción no haya sido cancelada ni completada. |
| `SubscriptionMaxCyclesReached` | 65 | La suscripción ha alcanzado su número máximo de ciclos de cobro. | Cree una nueva suscripción si es necesario. |
| `SubscriptionIntervalNotElapsed` | 66 | El intervalo requerido entre cobros de suscripción aún no ha transcurrido. | Espere al próximo ciclo de facturación. |
