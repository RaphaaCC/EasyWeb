# EasyWeb API

API REST e WebSocket em Node.js para os recursos adaptativos da extensão EasyWeb. Ela oferece perfis, análise determinística de metadados de acessibilidade e planos declarativos para a Experiência Adaptativa.

> A API nunca executa HTML, CSS ou JavaScript recebido da extensão ou devolvido pelo modelo de IA.

## Requisitos e instalação

- Node.js 20 ou superior;
- MySQL compatível, se o armazenamento de snapshots e planos for necessário.

```powershell
npm install
Copy-Item .env.example .env
```

Edite `.env` antes de iniciar o serviço. Para desenvolvimento, use `npm run dev`; esse comando reinicia a API quando os arquivos são alterados. Para uma execução normal, use `npm start`. Por padrão, o serviço responde em `http://127.0.0.1:3001`.

## Configuração do MySQL

Preencha `MYSQL_HOST`, `MYSQL_USER` e `MYSQL_DATABASE` no `.env`. A senha só pode ficar vazia quando isso for permitido pelo MySQL local. Para conexões TLS, defina `MYSQL_SSL=true`; em produção, mantenha `MYSQL_SSL_REJECT_UNAUTHORIZED=true`.

O handler em `src/handlers/mysql-handler.js` cria o pool na primeira utilização, usa consultas parametrizadas e oferece transações com rollback automático. Quando o banco está configurado, a inicialização sincroniza o schema antes de abrir as portas HTTP e WebSocket. Se essa sincronização falhar, a API não inicia.

```powershell
npm run db:sync
# O alias abaixo executa a mesma sincronização:
npm run db:migrate
```

As tabelas sincronizadas incluem `easyweb_site_snapshots`, `easyweb_adaptation_families`, `easyweb_adaptation_base_plans` e `easyweb_adaptation_jobs`. Os payloads são sanitizados, convertidos para JSON e comprimidos com `gzip` em um `LONGBLOB`. A sincronização preserva snapshots, planos e filas existentes; na versão 5, ela remove apenas a tabela legada `easyweb_installations`, que armazenava o recurso de matrícula descontinuado.

## Identidade local e retenção

A extensão gera um identificador local aleatório para separar snapshots e pedidos pessoais. Não existe matrícula, segredo de instalação ou conta de usuário nesse protocolo. O identificador não contém dados pessoais e não é usado como autenticação.

`SNAPSHOT_RETENTION_DAYS` define por quantos dias a API mantém snapshots sem nova observação; o padrão é 30. A limpeza roda na inicialização e diariamente, em lotes definidos por `SNAPSHOT_RETENTION_BATCH_SIZE`. Quando uma exclusão deixa uma família sem snapshots-fonte, os jobs e planos derivados também são removidos. A página de configurações permite apagar os snapshots associados ao identificador local desta extensão.

## IA com Gemini

Para habilitar a análise de IA, defina `GEMINI_API_KEY` com uma chave do Google AI Studio. O modelo padrão é `gemini-3.8-flash`; altere-o com `GEMINI_MODEL`. Sem a chave, os snapshots continuam podendo ser armazenados, mas a análise fica indisponível e nenhum provedor externo é chamado.

O modelo recebe snapshots sanitizados e compatíveis da mesma origem para criar um plano base compartilhado. Um pedido pessoal pode usar o snapshot protegido atual, o perfil e o catálogo fechado de ações. O catálogo inclui legibilidade de texto, títulos, navegação, formulários, foco, links, contraste, movimento, controles maiores e cores de texto de uma paleta segura. Antes de persistir uma resposta, a API remove ações, escopos e parâmetros que não pertencem ao catálogo.

Cada chamada tem timeout, retentativas para `408`, `429` e erros `5xx`, além de um circuit breaker. Após três falhas transitórias consecutivas, novas chamadas ficam suspensas por 60 segundos por padrão. Ajuste esses valores com `GEMINI_TIMEOUT_MS`, `GEMINI_RETRY_ATTEMPTS`, `GEMINI_CIRCUIT_FAILURE_THRESHOLD` e `GEMINI_CIRCUIT_COOLDOWN_MS`.

Todas as chamadas ao Gemini passam por uma fila serial e limitada em memória. Pedidos pessoais enviados pelo popup têm prioridade sobre análises base pendentes; uma chamada que já começou termina antes da próxima iniciar. Os logs `ai.request.queued`, `ai.request.started`, `ai.request.completed`, `ai.request.failed` e `ai.request.rejected` mostram tipo, origem, duração e, para pedidos pessoais, o texto já sanitizado e truncado.

## Fila de planos base

Planos base compartilhados são criados pela fila persistente `easyweb_adaptation_jobs`. O WebSocket confirma primeiro o snapshot; depois, o worker reivindica um job por vez, envia a geração pela fila serial do Gemini e registra tentativas, atraso da nova tentativa e falha final.

Uma família só entra na fila quando as capturas são estruturalmente compatíveis, possuem evidência independente e atingem o escore mínimo de confiança. Páginas estáticas precisam de duas amostras compatíveis; famílias com sinais de dinamismo precisam de pelo menos três. A evidência pode vir de instalações diferentes, rotas diferentes ou observação de uma mesma instalação por ao menos dez minutos.

A API mede estabilidade estrutural, dinamismo, oportunidade de acessibilidade e confiança da família. Se a estrutura for estável, mas não houver uma melhoria automática segura, ela registra esse resultado e não chama o Gemini. Os escores e estados agregados ficam disponíveis no painel técnico, sem expor o conteúdo de snapshots.

## Rotas REST

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Verifica a saúde do serviço. |
| `GET` | `/api/v1/health/database` | Verifica a disponibilidade do MySQL. |
| `GET` | `/api/v1/profiles` | Lista perfis e filtros de cor suportados. |
| `GET` | `/api/v1/profiles/:id` | Obtém um perfil específico. |
| `POST` | `/api/v1/accessibility/analyze` | Gera recomendações a partir de um resumo da página. |

## Painel técnico local

Defina um token aleatório em `EASYWEB_ADMIN_TOKEN`:

```env
EASYWEB_ADMIN_TOKEN=insira-um-token-aleatorio-longo
```

Com a API em execução, abra `/api/v1/internal/dashboard` e informe o token. O painel exibe apenas métricas operacionais: quantidade e tamanho de snapshots, origens e rotas recentes, planos ativos e estado da fila. Ele não exibe HTML, CSS, JavaScript ou payload bruto.

A rota de dados exige o cabeçalho `X-EasyWeb-Admin-Token`. O painel não existe quando `EASYWEB_ADMIN_TOKEN` não está configurado.

## Protocolo WebSocket

O endpoint local é `ws://127.0.0.1:3001/ws`. Em produção, publique-o como `wss://easyweb.api.raemi.xyz/ws`.

Mensagens principais:

- `easyweb:hello`, com `protocolVersion: 1` e um `installationId` local aleatório, conclui o handshake da extensão;
- `easyweb:ping` recebe `easyweb:pong` para manter a conexão ativa;
- `easyweb:mapping:snapshot` envia um snapshot estrutural autorizado após o handshake;
- `easyweb:mapping:stored` e `easyweb:mapping:rejected` confirmam o mesmo `snapshotId`;
- `easyweb:adaptation:status` e `easyweb:adaptation:base-plan` acompanham a comparação de famílias e entregam um plano base validado;
- `easyweb:adaptation:personal-request` e `easyweb:adaptation:personal-plan` tratam ajustes solicitados no popup e entregues apenas ao socket solicitante.
- `easyweb:privacy:delete-snapshots` remove os snapshots associados ao identificador local da conexão e devolve apenas as contagens removidas.

O servidor rejeita conexões iniciadas por páginas Web, snapshots maiores que 512 KB, caminhos com parâmetros ou fragmentos, identificadores inválidos e envios repetidos em menos de três segundos. Pedidos pessoais no mesmo socket têm intervalo mínimo de 15 segundos. Clientes de serviço sem cabeçalho `Origin` continuam aceitos para testes e integrações locais.

Antes de gravar, a API reduz o HTML à topologia de tags e remove texto, atributos, scripts e elementos incorporados. No CSS, remove imports, fontes remotas, URLs externas e construções executáveis. Cookies, textos, atributos identificáveis, URLs completas de assets e código JavaScript não entram no banco. O payload nunca é escrito no log.

## Segurança e privacidade

- Limite do corpo JSON: `100 KB`.
- Cabeçalhos de segurança fornecidos pelo Helmet.
- CORS configurável por `CORS_ORIGIN`.
- Snapshots estruturais autorizados são persistidos como JSON comprimido no MySQL quando o banco está configurado.
- Não existe matrícula nem segredo de instalação no protocolo.
- Snapshots expiram automaticamente e podem ser removidos sob demanda pela extensão que mantém o identificador local correspondente.
- Nenhum conteúdo enviado pelo cliente é executado.

## Testes

```powershell
npm test
```
