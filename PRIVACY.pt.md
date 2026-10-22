# Política de Privacidade — LumenFlow

**Data de vigência:** 2026-07-25  
**Última atualização:** 2026-07-25

LumenFlow é um protocolo de processamento de pagamentos descentralizado construído sobre o blockchain [Stellar Soroban](https://soroban.stellar.org). Esta Política de Privacidade explica quais dados pessoais são processados por meio dos contratos inteligentes do LumenFlow, como são tratados e os direitos disponíveis aos titulares de dados sob o Regulamento Geral de Proteção de Dados (GDPR) e da Lei Geral de Proteção de Dados (LGPD) brasileira e leis de privacidade equivalentes.

---

## 1. Controlador de Dados

O LumenFlow é um protocolo de código aberto. A entidade que opera uma implantação específica dos contratos inteligentes do LumenFlow é o controlador de dados para essa implantação. Se você não tem certeza de quem opera a implantação com a qual está interagindo, entre em contato com a plataforma ou aplicativo que você usou para acessar o LumenFlow.

Para dúvidas sobre esta política ou para exercer seus direitos, entre em contato com:

- **E-mail:** privacy@lumenflow.example.com  
- **Issues no GitHub:** https://github.com/Gloriachinedu/lumenflow-contracts/issues (use a etiqueta `privacy`)

---

## 2. Quais Dados São Armazenados

O contrato inteligente do LumenFlow armazena as seguintes categorias de dados on-chain como parte dos perfis de comerciantes:

| Campo | Descrição | Categoria |
|-------|-----------|-----------|
| `address` | Chave pública Stellar (endereço da carteira) | Identificador pseudônimo |
| `name` | Nome de exibição do comerciante | Potencialmente pessoal (para autônomos) |
| `description` | Descrição em texto livre do negócio do comerciante | Potencialmente pessoal |
| `contact_info` | Dados de contato (e-mail, URL, etc.) | Potencialmente pessoal |
| `category` | Categoria do negócio | Não pessoal |
| `active` | Se a conta do comerciante está ativa | Não pessoal |
| `verified` | Se o comerciante foi verificado | Não pessoal |
| `registered_at` | Timestamp do registro do comerciante | Não pessoal |
| `total_received` | Volume acumulado de pagamentos recebidos | Não pessoal |

Os registros de pagamento também armazenam:

| Campo | Descrição | Categoria |
|-------|-----------|-----------|
| `payer` | Chave pública Stellar do pagador | Identificador pseudônimo |
| `merchant_address` | Chave pública Stellar do comerciante | Identificador pseudônimo |
| `amount` | Valor do pagamento | Não pessoal |
| `paid_at` | Timestamp do pagamento | Não pessoal |
| `memo` | Nota de pagamento opcional (fornecida pelo usuário) | Potencialmente pessoal |

> **Aviso de imutabilidade do blockchain:** Os registros de pagamento são armazenados no blockchain Stellar. Uma vez confirmados, os dados de transação (incluindo os logs de eventos on-chain) não podem ser excluídos. No entanto, os campos do perfil do comerciante (`name`, `description`, `contact_info`) que podem conter dados pessoais **podem** ser anonimizados por meio do procedimento de exclusão de dados descrito na Seção 5.

---

## 3. Base Legal para o Processamento

O LumenFlow processa os dados acima com base nas seguintes bases legais sob o Artigo 6 do GDPR:

- **Execução de contrato (Art. 6(1)(b)):** O processamento é necessário para registrar e identificar comerciantes e para executar transações de pagamento.
- **Interesses legítimos (Art. 6(1)(f)):** Manutenção do histórico de pagamentos e estatísticas globais para prevenção de fraudes, resolução de disputas e integridade do sistema.
- **Obrigação legal (Art. 6(1)(c)):** Retenção de registros de transações pelo período exigido pela regulamentação financeira aplicável.

> **Nota LGPD:** No Brasil, as mesmas bases legais se aplicam nos termos dos artigos 7º e 11 da Lei nº 13.709/2018 (LGPD): execução de contrato (art. 7º, V), interesse legítimo (art. 7º, IX) e obrigação legal (art. 7º, II).

---

## 4. Retenção de Dados

| Tipo de dado | Período de retenção | Base |
|--------------|---------------------|------|
| Perfil do comerciante (campos de PII) | Até que a exclusão seja solicitada e confirmada | Execução de contrato |
| Registros de pagamento (on-chain) | Indefinido (imutabilidade do blockchain) | Interesses legítimos / obrigação legal |
| Registros de pagamento (armazenamento do contrato) | Período de limpeza configurável (padrão: 90 dias) | Critério do administrador |
| Logs de eventos (Horizon/arquivo) | Sujeito à política de arquivo da rede Stellar | Stellar Foundation |

Os administradores podem configurar um período de limpeza de pagamentos mais curto usando `set_payment_cleanup_period` e remover registros desatualizados com `cleanup_expired_payments`.

---

## 5. Direito ao Apagamento (Direito de Ser Esquecido)

Nos termos do Artigo 17 do GDPR, os titulares de dados têm o direito de solicitar o apagamento de seus dados pessoais. O LumenFlow implementa este direito por meio da função de contrato `request_merchant_data_deletion`.

### O que acontece quando você solicita a exclusão

Quando uma solicitação de exclusão é confirmada, os seguintes campos de PII no perfil do comerciante on-chain são substituídos pelo valor de espaço reservado `[deleted]`:

- `name` → `[deleted]`
- `description` → `[deleted]`
- `contact_info` → `[deleted]`

A chave pública Stellar do comerciante (`address`) é retida como uma referência pseudônima para preservar a integridade dos registros de pagamento existentes. Os valores dos pagamentos, timestamps e outros campos não-PII nos registros de pagamento também são retidos para fins de manutenção de registros financeiros.

Um evento `lumenflow/merchant_data_deleted` é emitido on-chain quando a exclusão é concluída.

### Limitações

Devido à natureza imutável do blockchain Stellar:

- Os **logs de eventos** on-chain e o **histórico de transações** registrado pelos nós Stellar Horizon estão fora do controle do LumenFlow e não podem ser excluídos.
- As **cópias off-chain** de dados (backups, sistemas de análise, integrações de terceiros) devem ser tratadas separadamente pelo operador da plataforma.

### Como solicitar a exclusão

Consulte [docs/merchant-onboarding.md — Exclusão de Dados](docs/merchant-onboarding.md#data-deletion) para obter instruções passo a passo.

---

## 6. Outros Direitos dos Titulares de Dados

Nos termos do GDPR e leis equivalentes, você tem os seguintes direitos:

| Direito | Como exercer |
|---------|--------------|
| **Acesso (Art. 15)** | Chame `get_merchant(merchant_address)` para recuperar seu perfil armazenado. |
| **Retificação (Art. 16)** | Chame `update_merchant` para corrigir informações imprecisas. |
| **Apagamento (Art. 17)** | Siga o [procedimento de exclusão de dados](docs/merchant-onboarding.md#data-deletion). |
| **Restrição (Art. 18)** | Entre em contato com privacy@lumenflow.example.com para discutir a restrição do processamento. |
| **Portabilidade (Art. 20)** | Seu perfil e histórico de pagamentos são legíveis por meio das funções de consulta pública do contrato. |
| **Oposição (Art. 21)** | Entre em contato com privacy@lumenflow.example.com. Observe que determinados processamentos são necessários para a execução do contrato. |
| **Revisão de decisões automatizadas (Art. 20 LGPD)** | Entre em contato com privacy@lumenflow.example.com para solicitar revisão humana de quaisquer decisões automatizadas que afetem você. |

Para exercer qualquer um desses direitos, envie um e-mail para **privacy@lumenflow.example.com** ou abra uma issue no GitHub com a etiqueta `privacy`.

---

## 7. Dados de Crianças

Os serviços do LumenFlow são destinados a empresas e pessoas com 18 anos ou mais. Não coletamos nem processamos conscientemente dados pessoais de crianças menores de 16 anos (ou a idade mínima aplicável na jurisdição relevante). Se você acredita que uma criança registrou um perfil de comerciante, entre em contato com **privacy@lumenflow.example.com** e tomaremos as medidas apropriadas para remover os dados.

---

## 8. Transferências Internacionais de Dados

Os dados do blockchain Stellar são replicados em uma rede de validadores distribuída globalmente. Ao interagir com o contrato inteligente do LumenFlow, você reconhece que os dados armazenados on-chain podem ser replicados para nós em jurisdições fora do Espaço Econômico Europeu. A rede Stellar não fornece cláusulas contratuais padrão nem uma decisão de adequação. Os operadores de implantação que dependem de infraestrutura off-chain devem garantir que mecanismos de transferência adequados estejam em vigor.

---

## 9. Segurança

O LumenFlow utiliza as seguintes medidas técnicas para proteger os dados:

- Todas as funções que alteram o estado requerem autorização criptográfica do endereço relevante (comerciante, pagador ou administrador).
- O contrato pode ser pausado por um administrador em resposta a um incidente de segurança.
- As atualizações do perfil do comerciante requerem a assinatura do próprio comerciante, impedindo modificações não autorizadas.
- As solicitações de exclusão requerem confirmação do administrador em até 30 dias.

Para divulgação responsável de vulnerabilidades de segurança, consulte [SECURITY.md](SECURITY.md).

---

## 10. Cookies e Rastreamento

O contrato inteligente do LumenFlow em si não utiliza cookies nem tecnologias de rastreamento. Aplicativos front-end construídos sobre o LumenFlow podem usar cookies ou análises; consulte as políticas de privacidade dessas aplicações para obter detalhes.

---

## 11. Alterações nesta Política

Podemos atualizar esta política periodicamente. Alterações materiais serão anunciadas por meio do [repositório GitHub](https://github.com/Gloriachinedu/lumenflow-contracts) e anotadas em [CHANGELOG.md](CHANGELOG.md). A data de "Última atualização" no topo deste documento indica quando a política foi revisada pela última vez.

---

## 12. Contato

Para todas as consultas relacionadas à privacidade:

- **E-mail:** privacy@lumenflow.example.com  
- **GitHub:** https://github.com/Gloriachinedu/lumenflow-contracts/issues (etiqueta `privacy`)
- **Discord:** https://discord.gg/lumenflow
