# LumenFlow

**Contratos inteligentes escaláveis, seguros e descentralizados para Soroban na Stellar.**

[![CI](https://github.com/Gloriachinedu/lumenflow-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/Gloriachinedu/lumenflow-contracts/actions/workflows/ci.yml)
[![Licença: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-blueviolet)](https://soroban.stellar.org)

[English](README.md) | [Español](README.es.md) | [Português](README.pt.md)

---

## Visão Geral

LumenFlow é um contrato inteligente de processamento de pagamentos de nível de produção para a rede [Stellar Soroban](https://soroban.stellar.org). Ele oferece:

- **Gestão de comerciantes** — registro, perfis, desativação
- **Processamento de pagamentos** — transferências de tokens verificadas por assinatura ed25519
- **Ciclo de vida de reembolsos** — iniciar → aprovar/rejeitar → executar
- **Pagamentos multi-assinatura** — aprovações de limite configuráveis
- **Consultas de histórico de pagamentos** — paginadas, filtradas e ordenadas
- **Controles de administração** — estatísticas globais, arquivamento, limpeza automática

## Segurança e Documentação

- Plano e escopo de auditoria publicados em `docs/audit/audit-report.md`
- Diagrama de estado do ciclo de vida de reembolsos disponível em `docs/refund-lifecycle.md`
- Guia de testes disponível em `docs/testing-guide.md`
- Guia de pagamentos multi-assinatura disponível em `docs/multisig-guide.md`

## Estrutura do Projeto

```
lumenflow-contracts/
├── contracts/
│   └── lumenflow/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs        # Pontos de entrada do contrato
│           ├── types.rs      # Estruturas de dados
│           ├── storage.rs    # Auxiliares de armazenamento persistente
│           ├── error.rs      # Códigos de erro tipados
│           ├── helper.rs     # Utilitários de autenticação e validação
│           └── test.rs       # Testes unitários
```

## Pré-requisitos

| Ferramenta | Instalação |
|------|---------|
| Rust (estável) | https://rustup.rs |
| Stellar CLI | https://developers.stellar.org/docs/tools/stellar-cli |
| Docker Desktop | https://www.docker.com/products/docker-desktop |

---

## Compilação

```bash
cargo build --target wasm32-unknown-unknown --release --package lumenflow
```

## Testes

```bash
cargo test --all-features
```

---

## API do Contrato

### Registro de Comerciante

1. **Conectar Carteira**: Certifique-se de que sua carteira Stellar está conectada.
2. **Verificar Registro**: Chame `is_registered(address)`.
3. **Registrar**: Chame `register_merchant` com os detalhes do seu negócio.

### Processamento de Pagamentos

```bash
# Processar pagamento com assinatura
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

## Contribuição

Veja [CONTRIBUTING.md](CONTRIBUTING.md). Todas as contribuições são bem-vindas: correções de bugs, funcionalidades, documentação e traduções.

## Licença

[MIT](LICENSE) © 2026 LumenFlow Contributors
