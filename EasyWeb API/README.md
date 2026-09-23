# EasyWeb API

API REST em Node.js para apoiar a extensão EasyWeb. Ela expõe os perfis da extensão, uma análise determinística de metadados de acessibilidade e o fluxo de planos declarativos para a Experiência Adaptativa. A API não executa HTML, CSS ou JavaScript recebido da extensão ou devolvido pelo modelo.

## Requisitos

- Node.js 20 ou superior

## Instalação

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Por padrão, a API responde em `http://127.0.0.1:3001`.

## MySQL

A API possui um handler interno reutilizável em `src/handlers/mysql-handler.js`. Ele cria o pool apenas no primeiro uso, executa consultas parametrizadas e disponibiliza transações com rollback automático. Assim, a API pode ser iniciada antes do banco estar configurado.

Copie `.env.example` para `.env` e preencha `MYSQL_HOST`, `MYSQL_USER` e `MYSQL_DATABASE`. A senha pode ficar vazia somente quando isso for compatível com o MySQL local. Para conexões TLS, defina `MYSQL_SSL=true`; mantenha `MYSQL_SSL_REJECT_UNAUTHORIZED=true` em produção.

Rotas futuras obtêm o handler pelo mesmo pool em `request.app.locals.database`:

```js
const { rows } = await request.app.locals.database.query(
  "SELECT id, name FROM users WHERE id = ?",
  [userId]
);
```

Ao iniciar a API manualmente, ela sincroniza automaticamente o schema MySQL canônico antes de abrir a porta HTTP/WebSocket. A mesma definição declara as três tabelas, as colunas, as chaves primárias e os índices necessários; em cada inicialização, ela reconcilia colunas e índices conhecidos sem apagar snapshots, famílias ou planos existentes. Se o banco estiver configurado, mas a sincronização falhar, a API não inicia para evitar receber snapshots sem tabela compatível. O comando abaixo continua disponível para executar a mesma sincronização isoladamente:

```powershell
npm run db:sync
```

O comando sincroniza `easyweb_site_snapshots`, `easyweb_adaptation_families` e `easyweb_adaptation_base_plans` sem apagar os registros existentes. Cada payload é um JSON sanitizado e comprimido com `gzip` dentro de um `LONGBLOB`. O alias antigo `npm run db:migrate` permanece disponível e executa a mesma sincronização.

## Gemini

Para habilitar a análise de IA, defina `GEMINI_API_KEY` no arquivo `.env` com a chave do Google AI Studio. O modelo padrão é `gemini-3.8-flash`, configurável com `GEMINI_MODEL`; mantenha um modelo disponível na camada gratuita da sua conta. Sem a chave, snapshots continuam sendo armazenados, mas a API informa que a análise está indisponível e não chama nenhum provedor externo.

O modelo recebe dois snapshots sanitizados e compatíveis de uma mesma origem para criar um plano base compartilhado. Um pedido pessoal explícito pode usar somente o snapshot protegido atual, o perfil e o catálogo fechado de ações, mesmo quando ainda não existir plano base. A resposta precisa ser JSON estruturado. Antes de ser persistida, a API remove ações, escopos e parâmetros que não pertencem ao catálogo. O MySQL armazena somente snapshots, famílias e planos base. Solicitações pessoais e seus planos passam pela memória da conexão WebSocket e são entregues exclusivamente para a extensão que pediu o ajuste.

## Fila de planos base

Planos base compartilhados sao criados por uma fila persistente em
`easyweb_adaptation_jobs`. O WebSocket confirma o snapshot primeiro; o worker
da API reivindica um job por vez, gera o plano e registra tentativas, atraso de
nova tentativa e falha final. Um plano concluido e entregue aos sockets que
enviaram ou consultaram a mesma origem.

Uma familia so entra na fila quando os snapshots forem estruturalmente
compativeis e confiaveis: duas instalacoes diferentes, ou duas rotas diferentes
observadas na mesma instalacao durante pelo menos dez minutos. Isso reduz a
chance de uma captura isolada criar uma adaptacao compartilhada.

## Tolerancia ao Gemini

Cada chamada possui timeout configuravel, retentativas para `408`, `429` e
erros `5xx`, e um circuit breaker. Depois de tres falhas transitorias seguidas,
novas chamadas ficam suspensas por sessenta segundos, por padrao. Os limites
podem ser ajustados com `GEMINI_TIMEOUT_MS`, `GEMINI_RETRY_ATTEMPTS`,
`GEMINI_CIRCUIT_FAILURE_THRESHOLD` e `GEMINI_CIRCUIT_COOLDOWN_MS`.

## Rotas

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Verifica a saúde do serviço. |
| `GET` | `/api/v1/health/database` | Verifica a disponibilidade da conexão MySQL. |
| `GET` | `/api/v1/profiles` | Lista perfis e filtros de cor suportados. |
| `GET` | `/api/v1/profiles/:id` | Obtém um perfil específico. |
| `POST` | `/api/v1/accessibility/analyze` | Cria recomendações seguras a partir de um resumo da página. |

## Painel técnico

Defina um token aleatório em `EASYWEB_ADMIN_TOKEN` para habilitar o painel local de operação:

```env
EASYWEB_ADMIN_TOKEN=replace-with-a-long-random-admin-token
```

Com a API em execução, abra `/api/v1/internal/dashboard` e informe o token. O painel mostra somente métricas operacionais: quantidade e tamanho de snapshots, origens e rotas recentes, planos ativos e estado da fila persistente. Ele não expõe o HTML, CSS, JavaScript ou o payload bruto capturado. A rota de dados exige o cabeçalho `X-EasyWeb-Admin-Token` e o painel não existe quando o token não está configurado.

## WebSocket

O endpoint WebSocket é `ws://127.0.0.1:3001/ws` localmente e deve ser publicado como `wss://easyweb.api.raemi.xyz/ws` em produção. O protocolo aceita:

- `easyweb:hello`, com `protocolVersion: 1`, para identificar a extensão;
- `easyweb:ping`, respondido por `easyweb:pong`, para manter a conexão ativa.
- `easyweb:mapping:snapshot`, somente após o handshake, com um `snapshotId` único para armazenar um snapshot estrutural autorizado.
- `easyweb:mapping:stored` ou `easyweb:mapping:rejected`, que confirmam o mesmo `snapshotId` para a extensão decidir se pode deduplicar ou reenviar o item.
- `easyweb:adaptation:status` e `easyweb:adaptation:base-plan`, que acompanham a comparação de famílias e entregam um plano base validado.
- `easyweb:adaptation:personal-request` e `easyweb:adaptation:personal-plan`, usados para um ajuste solicitado no popup e entregue somente ao socket solicitante.

O servidor rejeita snapshots maiores que 512KB, caminhos com parâmetros ou fragmentos, identificadores inválidos e envios repetidos em menos de três segundos. Pedidos pessoais no mesmo socket têm intervalo mínimo de quinze segundos. Antes de gravar, filtra HTML para reter somente a topologia de tags e remove texto, atributos, scripts e elementos incorporados; no CSS, remove imports, fontes remotas, URLs externas e construções executáveis. Cookies, textos, atributos HTML identificáveis, URLs completas de assets e código JavaScript não entram no banco.

O navegador evita reenviar o mesmo template confirmado. No banco, a API conserva uma amostra por rota e estrutura para permitir a comparação de páginas diferentes que compartilham o mesmo template. O console registra somente origem, caminho, tamanho e assinatura curta do template recebido; o payload nunca é escrito no log.

## Exemplo de análise

```json
{
  "page": {
    "url": "https://exemplo.com/noticia"
  },
  "summary": {
    "pageType": "article",
    "hasMainContent": true,
    "minimumContrast": 3.2,
    "averageFontSize": 14,
    "linksRelyOnColor": true,
    "hasMotion": true,
    "isDynamic": false,
    "hasExternalAccessibilityTool": false
  }
}
```

O resultado contém ações suportadas pelo EasyWeb, explicações, alertas de compatibilidade e uma confiança de `0` a `1`. A extensão deve validar as ações e manter a decisão final com o usuário.

## Segurança e privacidade

- Limite de corpo JSON: `100kb`.
- Cabeçalhos de segurança via Helmet.
- CORS configurável por `CORS_ORIGIN`.
- Snapshots estruturais autorizados são persistidos como JSON comprimido no MySQL quando o banco está configurado.
- Nenhuma execução de conteúdo enviado pelo cliente.

## Testes

```powershell
npm test
```
