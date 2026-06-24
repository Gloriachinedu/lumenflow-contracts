# LumenFlow

**Contratos inteligentes escalables, seguros y descentralizados para Soroban en Stellar.**

[![CI](https://github.com/Gloriachinedu/lumenflow-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/Gloriachinedu/lumenflow-contracts/actions/workflows/ci.yml)
[![Licencia: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-blueviolet)](https://soroban.stellar.org)

[English](README.md) | [Español](README.es.md) | [Português](README.pt.md)

---

## Resumen

LumenFlow es un contrato inteligente de procesamiento de pagos de grado de producción para la red [Stellar Soroban](https://soroban.stellar.org). Proporciona:

- **Gestión de comercios** — registro, perfiles, desactivación
- **Procesamiento de pagos** — transferencias de tokens verificadas mediante firma ed25519
- **Ciclo de vida de reembolsos** — iniciar → aprobar/rechazar → ejecutar
- **Pagos multi-firma** — aprobaciones de umbral configurables
- **Consultas de historial de pagos** — paginadas, filtradas y ordenadas
- **Controles de administración** — estadísticas globales, archivado, limpieza automática

## Seguridad y Documentación

- Plan de auditoría y alcance publicado en `docs/audit/audit-report.md`
- Diagrama de estado del ciclo de vida de reembolsos disponible en `docs/refund-lifecycle.md`
- Guía de pruebas disponible en `docs/testing-guide.md`
- Guía de pagos multi-firma disponible en `docs/multisig-guide.md`

## Estructura del Proyecto

```
lumenflow-contracts/
├── contracts/
│   └── lumenflow/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs        # Puntos de entrada del contrato
│           ├── types.rs      # Estructuras de datos
│           ├── storage.rs    # Ayudantes de almacenamiento persistente
│           ├── error.rs      # Códigos de error tipados
│           ├── helper.rs     # Utilidades de autenticación y validación
│           └── test.rs       # Pruebas unitarias
```

## Requisitos Previos

| Herramienta | Instalación |
|------|---------|
| Rust (estable) | https://rustup.rs |
| Stellar CLI | https://developers.stellar.org/docs/tools/stellar-cli |
| Docker Desktop | https://www.docker.com/products/docker-desktop |

---

## Construcción

```bash
cargo build --target wasm32-unknown-unknown --release --package lumenflow
```

## Pruebas

```bash
cargo test --all-features
```

---

## API del Contrato

### Registro de Comercio

1. **Conectar Billetera**: Asegúrese de que su billetera Stellar esté conectada.
2. **Verificar Registro**: Llame a `is_registered(address)`.
3. **Registrar**: Llame a `register_merchant` con los detalles de su negocio.

### Procesamiento de Pagos

```bash
# Procesar pago con firma
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY --network $NETWORK \
  -- process_payment_with_signature \
  --payer <payer-address> \
  --order_id "ORDER_001" \
  --merchant_address <merchant-address> \
  --token_address <token-address> \
  --amount 1000 \
  --memo "Invoice #001" \
  --signature <ed25519-signature-bytes> \
  --merchant_public_key <ed25519-public-key-bytes>
```

---

## Contribuir

Consulte [CONTRIBUTING.md](CONTRIBUTING.md). Todas las contribuciones son bienvenidas: corrección de errores, características, documentación y traducciones.

## Licencia

[MIT](LICENSE) © 2026 LumenFlow Contributors
