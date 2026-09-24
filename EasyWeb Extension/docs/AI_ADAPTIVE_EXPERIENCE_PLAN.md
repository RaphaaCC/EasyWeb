# Planejamento: IA para Experiência Adaptativa do EasyWeb

> **Status:** implementação beta em andamento na versão `v1.0.3 Beta`. O nível 1 já possui contrato WebSocket, armazenamento de planos base, integração com Gemini, validação de um catálogo fechado de ações, compilação local de CSS e cache local. Os recursos de níveis 2 e 3 continuam somente planejados.
>
> **Objetivo:** permitir que o EasyWeb use IA para recomendar e aplicar adaptações de acessibilidade e simplificação de navegação por site, de maneira reversível, verificável e controlada pelo usuário.

## 1. Visão do recurso

O EasyWeb já aplica perfis e ajustes visuais locais. A evolução proposta acrescenta uma camada chamada **Experiência Adaptativa**, capaz de tornar uma página mais clara para pessoas idosas, crianças e pessoas com deficiência sem modificar os arquivos do site, o servidor ou os dados do usuário.

A IA não recebe liberdade para executar código arbitrário na página. Ela produz um **plano declarativo de adaptação**: uma lista de intenções e componentes permitidos. A extensão interpreta esse plano por handlers próprios, com limites, validação e possibilidade de remoção imediata.

O plano terá duas camadas que podem ser cacheadas e evoluir separadamente:

- **Plano base do site:** gerado depois de a API comparar snapshots compatíveis
  de uma mesma família de páginas. Ele corrige barreiras comuns daquele site ou
  template e pode ser reutilizado por instalações autorizadas.
- **Plano pessoal:** gerado a partir de um pedido explícito no popup. Ele é
  associado somente à instalação que o solicitou, pode complementar um plano
  base quando houver ou funcionar de forma independente, e é armazenado
  exclusivamente no navegador do usuário, sem alterar a experiência dos demais
  usuários.

Essa separação é essencial:

| Responsabilidade | IA | EasyWeb no navegador |
| --- | --- | --- |
| Entender estrutura, barreiras e fluxo provável | Sim | Fornece snapshot protegido e regras |
| Sugerir mudanças de experiência | Sim | Valida o plano recebido |
| Rodar JavaScript gerado pelo modelo | Nunca | Nunca |
| Criar requisições, alterar URLs, cookies ou formulários | Nunca | Nunca |
| Aplicar estilos e componentes confiáveis | Define intenção | Executa somente handlers permitidos |
| Medir resultado, falhas e restaurar a página | Pode receber resultado agregado | Executa e decide reversão local |

## 2. Resultados esperados

O recurso deve melhorar, sem substituir, o algoritmo padrão do EasyWeb:

- aumentar legibilidade, contraste, foco de teclado, espaçamento e áreas clicáveis;
- reduzir distrações visuais e priorizar o conteúdo principal;
- apresentar navegação complexa de forma mais direta;
- explicar controles confusos com dicas locais e curtas;
- tornar formulários longos mais fáceis de percorrer, preservando os campos e o envio original;
- adaptar a apresentação ao perfil escolhido, sem mudar o conteúdo oficial, jurídico, financeiro ou educacional do site;
- permitir voltar à aparência normal ou ao algoritmo padrão em um clique.

O recurso não deve:

- ocultar definitivamente conteúdo do site;
- alterar texto do site como se fosse conteúdo oficial;
- completar, enviar, apagar ou reorganizar valores de formulários;
- clicar, comprar, pagar, autenticar, aceitar termos ou tomar decisões em nome do usuário;
- registrar texto digitado, senhas, cookies, cabeçalhos, sessões ou dados pessoais;
- gerar ou executar JavaScript, HTML remoto, `iframe`, `eval`, URLs externas ou seletores sem validação;
- bloquear o funcionamento original do site.

## Contrato implementado

O contrato em execucao e `EasyWebSiteScriptV1`, documentado em
[`EASYWEB_SITE_SCRIPT_V1.md`](EASYWEB_SITE_SCRIPT_V1.md). Ele substitui o
formato historico baseado em `actions` descrito nas secoes 10 a 12 deste
planejamento. Essas secoes permanecem como referencia de evolucao e de
migracao de planos antigos; a extensao nao executa JavaScript, CSS livre ou
qualquer codigo retornado pelo modelo.

## 3. Conceitos e nomenclatura

| Termo | Definição |
| --- | --- |
| **Snapshot** | Estrutura protegida da página já autorizada pelo usuário. Contém topologia HTML, CSS sanitizado e metadados agregados. |
| **Fingerprint de captura** | Assinatura calculada no navegador a partir de CSS sanitizado e metadados de ativos. Já é usada para evitar o reenvio de capturas visualmente semelhantes na mesma origem. |
| **Hash de snapshot** | Hash calculado pela API depois de normalizar o snapshot recebido. É usado na persistência e deduplicação no servidor. Não deve ser presumido idêntico ao fingerprint de captura. |
| **Assinatura de adaptação** | Assinatura futura e canônica para planos de IA. É calculada pela API a partir da origem, hash de snapshot e representação estrutural estável. É a chave correta para decidir se um plano ainda serve para a página. |
| **Chave de bootstrap** | Verificação local e barata, disponível no início do carregamento. Serve apenas para escolher se o CSS compilado de nível 1 pode entrar provisoriamente antes da confirmação completa. |
| **Template** | Variação de página reconhecida pela assinatura de adaptação. Um mesmo site pode ter vários templates. |
| **Plano adaptativo** | Resposta JSON da IA com ações permitidas para uma assinatura de adaptação. Não é um script executável. |
| **Família de páginas** | Grupo de snapshots da mesma origem com estrutura suficientemente semelhante para compartilhar um plano base. Não confunde páginas incompatíveis, como página inicial e checkout. |
| **Plano base** | Plano de adaptação canônico para uma família de páginas, com versão e expiração. |
| **Plano pessoal** | Plano privado, vinculado a uma instalação e perfil. Pode complementar um plano base ou ser criado diretamente a partir de um pedido explícito. A API o trata apenas em memória; somente a extensão o armazena. |
| **Handler** | Código local da extensão que interpreta uma ação aprovada, por exemplo, `improve-focus-ring`. |
| **Camada adaptativa** | Elementos do EasyWeb sobrepostos ou estilos próprios aplicados sem editar os arquivos do site. |
| **Validação local** | Verificações feitas pelo navegador antes, durante e depois da aplicação de um plano. |
| **Reversão** | Remoção integral da camada adaptativa e retorno ao perfil/algoritmo anterior. |

## 4. Modos de funcionamento

Os modos atuais continuam sendo a primeira decisão do usuário:

| Modo | Comportamento |
| --- | --- |
| **Padrão** | Usa somente o algoritmo local do EasyWeb. Não conecta à API, não cria snapshot e não usa plano de IA. |
| **Aprimorado** | Permite conexão com API, snapshots autorizados e, futuramente, planos adaptativos aprovados. |

Dentro do modo Aprimorado, a Experiência Adaptativa terá três níveis explícitos:

| Nível | Nome na interface | O que pode fazer |
| --- | --- | --- |
| 1 | **Ajustes assistidos** | Contraste, tamanho, foco, links, movimento, espaçamento e alvos clicáveis. |
| 2 | **Navegação simplificada** | Barra de leitura, organização de menus, foco no conteúdo principal, redução visual de conteúdo secundário e dicas locais. |
| 3 | **Fluxos guiados** | Apresentação alternativa de tabelas densas e orientação por etapas em formulários, mantendo sempre o acesso ao layout original. |

O nível 1 pode ser sugerido automaticamente, mas não é aplicado automaticamente
por padrão. A aplicação automática só pode ocorrer quando o usuário ativar essa
preferência, existir um plano local já validado e a página corresponder à
assinatura de adaptação. Os níveis 2 e 3 exigem autorização explícita do
usuário para aquele site, além da permissão global.

## 5. Perfis e objetivos de adaptação

Os perfis atuais continuam sendo a base. A IA não deve inferir uma condição médica; ela apenas usa a preferência escolhida para ajustar a prioridade das ações.

| Perfil | Prioridades da IA |
| --- | --- |
| **Padrão** | Corrigir barreiras detectáveis sem mudar a organização geral. |
| **Idoso** | Leitura grande, ações importantes evidentes, menus curtos, menos ruído visual e controles maiores. |
| **Crianças** | Hierarquia visual direta, menos escolhas simultâneas, instruções de contexto e alvos amplos. |
| **PCD** | Foco, contraste, teclado, movimento reduzido, previsibilidade e semântica visual. |
| **Daltônico** | Não depender só da cor, aplicar filtro quando escolhido e reforçar estados por texto, borda ou forma. |
| **Dislexia** | Espaçamento, leitura focada, redução de agrupamento visual e prioridade de conteúdo. |
| **Baixa visão** | Escala, contraste, foco, áreas clicáveis e organização da leitura. |
| **Sensibilidade visual** | Redução de animações, elementos piscantes e ruído visual. |
| **Leitura focada** | Conteúdo principal, ritmo de leitura e redução temporária de regiões periféricas. |

## 6. Preferências e consentimentos

### 6.1 Página completa de configurações

A página de configurações deve ter uma seção futura chamada **Experiência Adaptativa com IA**, organizada em blocos simples e independentes.

| Controle | Tipo | Padrão | Efeito |
| --- | --- | --- | --- |
| Usar modo Aprimorado | Seletor Padrão/Aprimorado | Padrão | Libera API, snapshots e configurações de IA. |
| Permitir snapshots para análise de IA | Switch global | Desligado | Necessário para autorização por site. |
| Usar recomendações de IA aprovadas | Switch global | Desligado | Permite buscar, pré-visualizar e aplicar planos já validados. |
| Nível máximo de adaptação | Seletor | Ajustes assistidos | Limita a complexidade de ações que a IA pode propor. |
| Adaptar automaticamente templates confiáveis | Switch | Desligado | Aplica automaticamente apenas planos locais, validados e de nível 1. |
| Mostrar uma prévia antes de aplicar | Switch | Ligado | Tem precedência sobre a aplicação automática e exibe Aplicar/Manter padrão. |
| Enviar avaliação anônima do resultado | Switch | Desligado | Envia somente resultado técnico e voto opcional; nunca conteúdo da página. |
| Limpar planos e histórico local | Botão | - | Remove cache local, avaliações e aprovações. |

Os consentimentos possuem escopos independentes:

- **Permitir snapshots para análise de IA** permite somente criar e transmitir
  novos snapshots, depois da autorização por site.
- **Usar recomendações de IA aprovadas** permite buscar, pré-visualizar e aplicar
  planos. Sem ela, nenhuma adaptação de IA é aplicada, mesmo se existir cache.
- Desativar snapshots interrompe novas capturas e limpa a fila de envio, mas não
  apaga automaticamente um plano local já aprovado. Desativar recomendações,
  desativar o EasyWeb ou bloquear a adaptação no site remove a camada ativa na
  mesma hora.
- A opção **Limpar planos e histórico local** remove também os planos aprovados,
  adaptações compiladas e autorizações de aplicação por site.

### 6.2 Campos de preferência do usuário

Esses campos são opcionais. Preferências pessoais ficam no armazenamento local; somente a informação mínima necessária para produzir o plano é enviada após consentimento.

| Campo | Tipo de controle | Valores ou limites | Uso no plano |
| --- | --- | --- | --- |
| Perfil principal | Seletor | Perfis do EasyWeb | Define prioridade de adaptação. |
| Tamanho preferido de leitura | Segmentado | Normal, Grande, Muito grande | Ajusta escala máxima sugerida. |
| Forma de navegação | Checkboxes | Mouse, teclado, toque, leitor de tela | Prioriza foco, teclado, alvos ou estrutura. |
| Reduzir distrações | Switch | Ligado/desligado | Permite reduzir visualmente regiões secundárias. |
| Mostrar orientação contextual | Switch | Ligado/desligado | Permite dicas do EasyWeb sobre controles e próxima ação. |
| Simplificar menus extensos | Switch | Ligado/desligado | Permite menu alternativo local, sem remover o original. |
| Guiar formulários longos | Switch | Ligado/desligado | Permite visão por etapas; nunca preenche ou envia campos. |
| Intensidade da adaptação | Seletor | Leve, Equilibrada, Forte | Limita quantidade e impacto das ações. |

Não haverá campos pedindo diagnóstico, deficiência, idade, documentos, endereço, dados financeiros ou qualquer informação identificável. O perfil é uma preferência de interface, não um dado médico.

### 6.3 Controles no popup por site

O popup precisa manter o caminho de decisão curto:

1. **Ativar EasyWeb**: liga ou desliga a extensão inteira.
2. **Modo de funcionamento**: Padrão ou Aprimorado.
3. **Configurações manuais para este site**: mantém o comportamento já existente de substituir o perfil global apenas naquela origem.
4. **Autorizar snapshot para análise de IA**: autorização por site, somente no modo Aprimorado e com consentimento global ativo.
5. **Aplicar adaptações automáticas de IA**: autorização independente para aplicar ou bloquear planos base daquele site. Não autoriza snapshots por si só e não bloqueia pedidos pessoais.
6. **Experiência adaptativa neste site**: bloco que permite pedir um ajuste pessoal logo após autorizar o snapshot, mesmo sem plano automático disponível.

O bloco futuro deve conter:

| Elemento | Função |
| --- | --- |
| Status do plano | Informa se não há plano, se está analisando, se está pronto, aplicado, reprovado ou desatualizado. |
| Resumo em linguagem simples | Exemplo: “Aumenta a leitura e simplifica o menu desta página.” |
| Lista de alterações | Mostra ações agrupadas por Leitura, Navegação, Controles e Movimento. |
| Prévia | Aplica temporariamente até a aba ser recarregada. |
| Aplicar neste site | Salva aceitação para o template atual. |
| Usar apenas o algoritmo padrão | Ignora o plano de IA naquele site. |
| Desfazer adaptação | Restaura imediatamente o estado anterior. |
| Reportar resultado | Opções: Ajudou, Não ajudou, Atrapalhou a página. |

Quando houver plano base e plano pessoal, a lista de alterações deve distingui-los
visualmente como **“Ajustes do site”** e **“Seus ajustes”**. Desfazer o plano
pessoal não remove o plano base; desativar a adaptação de IA naquele site remove
as duas camadas da aba atual.

O popup nunca deve usar textos vagos como “otimização inteligente”. Ele deve informar a ação concreta, por exemplo: “Destaque de foco reforçado”, “Menu secundário recolhido” ou “Tabela exibida também como cartões de leitura”.

#### Pedido de ajuda nesta página

O bloco de Experiência Adaptativa deve incluir uma caixa de texto opcional com o
título **“O que está difícil nesta página?”** e o placeholder **“Ex.: Não
consigo ler esta página”**. Ela permite que o usuário descreva a barreira que
está enfrentando antes de pedir uma análise.

Para tornar o uso rápido e acessível, a caixa deve oferecer sugestões que
preenchem o mesmo campo:

- Não consigo ler;
- A página está confusa;
- Os botões estão pequenos;
- O texto tem pouco contraste;
- Não encontro o que preciso;
- Quero uma navegação mais simples.

O texto terá limite de 280 caracteres, contador de caracteres e botão explícito
**“Pedir ajuda à IA”**. Nenhum texto é enviado enquanto o usuário digita. O
envio só ocorre depois de o usuário acionar esse botão, com modo Aprimorado,
consentimento global, autorização do site para snapshot e uso de recomendações
de IA ativos.

Antes do envio, a extensão remove quebras de linha excessivas, padrões de
dados sensíveis reconhecíveis e conteúdo acima do limite. Ela também classifica
localmente as sugestões conhecidas em intenções, como `reading-difficulty`,
`navigation-confusion`, `small-controls` e `low-contrast`. O texto livre é uma
preferência de assistência, não uma instrução privilegiada: não pode alterar o
catálogo de ações, permissões, limites, consentimentos ou regras de segurança.
Ele não entra no snapshot, não é adicionado ao cache do plano e não deve ser
persistido depois da resposta, salvo se o usuário escolher guardar o pedido
como preferência local. **O resultado da IA, porém, é cacheado:** o plano
pessoal e seu CSS compilado ficam vinculados à instalação e podem ser
reaplicados nos próximos acessos compatíveis. O sanitizador remove ou substitui
campos e valores sensíveis antes do envio e preserva a estrutura não sensível da
página para que a solicitação possa continuar.

## 7. Fluxo completo

1. O usuário seleciona o modo Aprimorado e autoriza snapshots globalmente.
2. No popup, autoriza uma origem específica para análise de IA.
3. A extensão filtra dados sensíveis e envia um snapshot estrutural para a API pelo WebSocket.
4. A extensão usa o fingerprint de captura para reduzir reenvios repetidos da mesma página, mas mantém uma janela de amostragem por origem para permitir uma segunda captura estruturalmente relevante.
5. A API normaliza e armazena cada snapshot protegido. Ela agrupa capturas compatíveis em uma família, calcula estabilidade, dinamismo, oportunidade de acessibilidade e confiança. Famílias estáticas exigem duas amostras; famílias dinâmicas exigem ao menos três, sempre com evidência por instalação, rota ou tempo de observação.
6. Se os snapshots forem incompatíveis, por exemplo uma página institucional e um checkout, a API os mantém em famílias separadas e aguarda novas amostras. Ela nunca usa duas páginas estruturalmente diferentes para gerar um único plano base.
7. Para uma família confirmada, a API seleciona um par representativo de snapshots protegidos, preserva os escores agregados da família e reúne os diagnósticos técnicos e as capacidades do executor. A IA recebe esse contexto e devolve um plano base JSON.
8. A API valida schema, ações, limites, versões e compatibilidade com a assinatura de adaptação; então armazena o plano base versionado.
9. A extensão recebe o plano base pelo WebSocket, ou o consulta ao carregar uma página compatível. Ela o valida novamente, compila a camada local e aplica conforme as preferências do usuário.
10. O popup mostra um resumo e, conforme a preferência, pede confirmação antes de aplicar.
11. Handlers locais aplicam as ações permitidas numa camada isolada do EasyWeb e o navegador verifica se a página continua estável e acessível.
12. Se houver falha, o plano é removido automaticamente e o algoritmo padrão permanece ativo.
13. O usuário pode manter, ajustar, desfazer ou avaliar a experiência adaptativa.

### 7.1 Plano base: análise por família confiável

O requisito mínimo de duas amostras para páginas estáticas não significa comparar quaisquer duas páginas do
mesmo domínio. A API deve comparar representações protegidas e calcular, no
mínimo, compatibilidade entre regiões semânticas, hierarquia de tags, densidade
de controles e assinatura visual. O resultado pode ser:

| Resultado da comparação | Decisão da API |
| --- | --- |
| Alta similaridade e confiança suficiente | Cria ou atualiza uma família de páginas e libera análise do plano base somente se houver oportunidade segura. |
| Similaridade intermediária | Mantém a família como candidata e aguarda outro snapshot. |
| Baixa similaridade | Cria famílias separadas e não compartilha plano entre elas. |

O cache atual de template confirmado não pode ser a única regra de deduplicação
no modo Aprimorado com IA: ele impediria a segunda amostra quando duas páginas
usassem os mesmos ativos. A extensão precisará de um amostrador separado,
limitado por origem, caminho, assinatura estrutural leve e janela de tempo. Ele
autoriza no máximo a quantidade necessária de snapshots protegidos para confirmar
uma família e volta a bloquear envios quando a API já tiver um plano válido.
Assim, a comparação recebe diversidade estrutural sem retransmitir cada página
visitada ou aumentar o uso de rede indefinidamente.

O plano base deve referenciar os dois hashes de snapshot usados na análise, a
assinatura de adaptação calculada, a versão do prompt, a versão do modelo e a
data de expiração. Quando uma captura posterior alterar a família de modo
relevante, a API cria uma nova versão do plano em vez de substituir
silenciosamente a versão em uso.

### 7.2 Pedido pessoal em tempo real

O usuário poderá escrever no popup o que está difícil assim que autorizar o
snapshot daquele site. A existência de um plano base é opcional: quando houver,
ele é enviado como contexto adicional; quando não houver, a solicitação usa
somente o snapshot protegido atual, o perfil e o pedido explícito. O fluxo
pessoal será:

1. A extensão captura um snapshot protegido do estado atual e associa o pedido
   sanitizado ao perfil, preferências e, se disponível, ao plano base vigente.
2. Ela envia uma solicitação pessoal pelo WebSocket, vinculada à instalação que
   a originou, sem persistir o pedido ou o resultado pessoal na API.
3. A API monta um prompt em tempo real com o snapshot atual, diagnósticos e
   pedido do usuário, acrescentando o plano base quando existir. O texto do
   pedido não recebe privilégio sobre as regras do prompt de sistema.
4. A IA devolve um **plano pessoal limitado**, que complementa o plano base
   quando ele existe ou atua diretamente sobre a página quando não existe.
5. A API valida esse delta somente em memória, associado ao socket e à
   solicitação em andamento. Ela não persiste o delta, o pedido ou CSS pessoal
   no MySQL.
6. A API envia o plano ao socket daquela instalação. A extensão valida, compila,
   aplica por cima do plano base quando existir e armazena o resultado para os
   próximos acessos.

O plano pessoal direto é reavaliado quando o perfil, as preferências ou o
snapshot relevante mudarem. Quando ele estiver vinculado a um plano base, também
é reavaliado se esse plano mudar. Ele nunca é reutilizado por outra instalação,
nunca altera o plano base compartilhado e não é recuperável pela API após o
encerramento da conexão. Caso a entrega falhe, o usuário poderá reenviar o
pedido; a API não mantém uma fila persistente desse conteúdo.

## 8. Dados enviados à IA

### 8.1 Contexto permitido

O payload de análise será derivado do snapshot já protegido e deve conter somente:

- origem e caminho sem query string ou fragmento;
- fingerprint de captura, hash de snapshot, assinatura de adaptação e versão de captura;
- árvore de tags e regiões semânticas, sem texto e sem atributos originais;
- contagem e posição estrutural de links, botões, campos, títulos, menus, tabelas e formulários;
- CSS sanitizado, tokens de cor, tipografia, tamanho, espaçamento e metadados agregados;
- indicadores calculados localmente, como contraste estimado insuficiente, foco invisível, botões pequenos, densidade de links e movimento detectado;
- preferências de interface estritamente necessárias, como perfil e intensidade;
- pedido opcional e sanitizado feito pelo usuário no popup, acompanhado de
  intenções locais quando reconhecidas;
- capacidades do executor local e a lista de ações permitidas.

### 8.2 Dados proibidos

Nunca incluir:

- texto de páginas, nomes, e-mails, documentos, endereços ou telefones;
- valores, rótulos ou atributos de campos de formulário;
- senhas, cookies, tokens, sessões, headers ou dados de autenticação;
- conteúdo de `localStorage`, `sessionStorage` ou IndexedDB;
- URLs completas de assets, parâmetros de URL, código JavaScript ou corpo de requisições;
- dados de pagamento, saúde, educação, localização, chats ou mensagens;
- identificação persistente da instalação fora do canal interno de entrega. A IA não precisa dela.

## 9. Prompt de sistema da IA

O serviço de IA deve receber um prompt de sistema fixo e versionado. Modelo inicial:

```text
Você é o planejador de experiência adaptativa do EasyWeb.

Sua função é diagnosticar barreiras de acessibilidade e navegação a partir de
um snapshot estrutural protegido. Você não escreve JavaScript, HTML, CSS livre,
URLs, consultas, nem instruções para ler ou alterar dados do usuário.

Responda exclusivamente com JSON compatível com o schema solicitado.

Você pode escolher somente ações presentes em allowedActions. Cada ação deve
ter uma justificativa curta, confiança entre 0 e 1, escopo limitado e valores
dentro dos bounds fornecidos. Nunca proponha remover conteúdo original,
interagir com formulários, mudar navegação do navegador, realizar ações de
compra/autenticação ou ocultar informações legais e de segurança.

Priorize mudanças reversíveis. Quando houver incerteza, produza menos ações e
reduza confidence. Considere o perfil como uma preferência de interface, sem
inferir diagnóstico médico, idade ou qualquer atributo pessoal.
```

## 10. Prompt de análise por template

Cada análise usa um prompt de tarefa com dados sanitizados e um contrato explícito:

```text
Analise o template abaixo para criar um plano de experiência adaptativa.

Perfil: {{profile}}
Intensidade: {{adaptationIntensity}}
Nível máximo permitido: {{maxAdaptationLevel}}
Preferências: {{minimalPreferences}}
Escopo da análise: {{planScope}}
Plano base vigente, quando existir: {{basePlan}}
Pedido opcional do usuário: {{sanitizedUserRequest}}
Intenções reconhecidas localmente: {{userIntentTags}}

Barreiras calculadas pelo EasyWeb:
{{detectedBarriers}}

Estrutura protegida da página:
{{protectedStructure}}

Metadados de estilos e interação:
{{styleAndInteractionMetadata}}

Ações permitidas:
{{allowedActions}}

Responda somente com o objeto JSON do schema EasyWebAdaptationPlanV1.
Selecione no máximo {{maxActions}} ações. Não invente tipos de ação, seletores
ou componentes. Se não houver melhoria segura, retorne actions vazia e explique
isso em summary. Quando planScope for personal e basePlan existir, produza um
delta compatível; não remova nem replique ações já presentes no plano base.
Quando basePlan for nulo, produza um plano pessoal independente usando apenas o
snapshot protegido, o perfil e o pedido explícito.
```

O backend deve montar `detectedBarriers`, `protectedStructure` e `styleAndInteractionMetadata` a partir de objetos, nunca por interpolação manual de conteúdo bruto.

## 11. Contrato de resposta: EasyWebAdaptationPlanV1

Exemplo de resposta válida:

```json
{
  "schemaVersion": 1,
  "planId": "base:exemplo.gov.br:b9d0a23a:v1",
  "planScope": "base",
  "origin": "https://exemplo.gov.br",
  "snapshotTemplateHash": "8aa0c47f3a0a3f0f1a4d7b91b9a8c2f2e6c2adfba5de9d4cc5a21cd5df405a21",
  "adaptationFingerprint": "b9d0a23ad9f5ca5d0a574d409c44ef8c6a2cc5887af67ce73d9b0c1a6fbd8f14",
  "profile": "elderly",
  "userRequest": {
    "text": "Não consigo ler esta página",
    "intentTags": ["reading-difficulty"]
  },
  "confidence": 0.89,
  "summary": "A página possui navegação densa e texto auxiliar pouco legível.",
  "recommendedLevel": 2,
  "actions": [
    {
      "id": "focus-main-content",
      "type": "focus-main-content",
      "scope": "main-content",
      "confidence": 0.93,
      "rationale": "A estrutura possui uma região principal identificável e várias regiões secundárias.",
      "parameters": {
        "dimSecondaryRegions": true
      }
    },
    {
      "id": "improve-focus-ring",
      "type": "improve-focus-ring",
      "scope": "interactive-elements",
      "confidence": 0.96,
      "rationale": "Elementos interativos não possuem foco visual consistente.",
      "parameters": {
        "minimumWidth": 3,
        "minimumOffset": 3
      }
    }
  ],
  "verification": {
    "requirePreview": true,
    "requireUserApproval": true,
    "rollbackOnLayoutInstability": true
  },
  "expiresAt": "2026-12-16T00:00:00.000Z"
}
```

### 11.1 Campos obrigatórios

| Campo | Regra |
| --- | --- |
| `schemaVersion` | Inteiro suportado pela extensão. |
| `planId` | Identificador versionado e imutável do plano. |
| `planScope` | `base` para plano da família ou `personal` para delta de uma instalação. |
| `origin` | Deve corresponder exatamente ao site solicitado. |
| `snapshotTemplateHash` | Deve corresponder ao hash de snapshot calculado pela API. |
| `adaptationFingerprint` | Deve corresponder à estrutura estável que o plano pode adaptar. |
| `profile` | Perfil usado para a recomendação. |
| `userRequest` | Pedido opcional já sanitizado; pode conter `text` limitado e `intentTags` reconhecidas localmente. |
| `confidence` | Número de `0` a `1`. Planos abaixo do limite não são aplicados. |
| `summary` | Texto curto para o usuário, sem afirmar diagnóstico. |
| `recommendedLevel` | `1`, `2` ou `3`, respeitando a preferência do usuário. |
| `actions` | Lista limitada de ações registradas no catálogo local. |
| `verification` | Regras de prévia, aprovação e reversão. |
| `expiresAt` | Data que impede reuso eterno de um plano. |

Para `planScope: "personal"`, `installationScope` é obrigatório e é um
identificador não reversível usado apenas durante a entrega no socket.
`basePlanId` é opcional: quando existir, aponta para a versão base sobre a qual
o delta foi criado; quando for `null`, o plano é uma adaptação pessoal direta.
A extensão rejeita um plano pessoal destinado a outra instalação ou um delta
associado a uma versão base diferente. A API não persiste esses dados em banco
após encerrar a solicitação.

### 11.2 Campos de cada ação

| Campo | Regra |
| --- | --- |
| `id` | Identificador único no plano. |
| `type` | Deve existir no catálogo de handlers. |
| `scope` | Escopo enumerado; não aceita seletor CSS devolvido pela IA na primeira versão. |
| `confidence` | Confiança daquela ação. |
| `rationale` | Justificativa curta, usada na interface e auditoria. |
| `parameters` | Somente chaves e faixas declaradas no catálogo daquela ação. |

## 12. Catálogo inicial de ações permitidas

O executor local decide como localizar regiões dentro de cada `scope`. A IA não retorna CSS livre nem seletores arbitrários.

| Tipo | Nível | Efeito permitido |
| --- | --- | --- |
| `set-text-scale` | 1 | Ajusta escala dentro do limite definido pelo usuário. |
| `set-reading-spacing` | 1 | Ajusta linha, letras e parágrafos em regiões de leitura. |
| `improve-focus-ring` | 1 | Reforça foco visível em elementos interativos. |
| `improve-link-distinction` | 1 | Diferencia links por sublinhado, cor e foco. |
| `improve-control-boundaries` | 1 | Reforça bordas e separação de botões e campos. |
| `raise-insufficient-contrast` | 1 | Ajusta apenas combinações comprovadamente insuficientes. |
| `reduce-motion` | 1 | Reduz transições, animações e rolagens não essenciais. |
| `increase-hit-targets` | 1 | Amplia áreas clicáveis sem mover a função original. |
| `css-adjustment` | 1 | Declara propriedades visuais permitidas que o compilador local converte em CSS complementar. |
| `focus-main-content` | 2 | Evidencia conteúdo principal e reduz visualmente regiões secundárias. |
| `simplified-navigation` | 2 | Cria menu alternativo local baseado em regiões e links reais. |
| `reading-toolbar` | 2 | Mostra barra local com leitura, zoom, contraste e retorno ao original. |
| `add-context-hints` | 2 | Acrescenta dicas neutras do EasyWeb, sem reescrever conteúdo oficial. |
| `group-related-actions` | 2 | Agrupa visualmente controles existentes sem mudar eventos. |
| `table-reading-cards` | 3 | Exibe visão alternativa de tabelas, preservando a tabela original. |
| `guided-form-view` | 3 | Cria uma visão por etapas para campos existentes, sem preencher ou enviar. |

Cada handler deve ter:

- versão própria;
- limites de parâmetros;
- seletor ou detector local auditável;
- função `apply`;
- função `validate`;
- função `rollback`;
- teste automatizado para sucesso e falha;
- descrição apresentada ao usuário.

### 12.1 CSS complementar gerado pela IA

Para adaptações visuais, a IA poderá propor uma folha de estilo complementar,
mas nunca editará os arquivos CSS originais do site. A extensão também não deve
injetar CSS bruto produzido pelo modelo sem análise. O fluxo obrigatório será:

```text
Plano de IA com intenções declarativas
    -> validador local
    -> compilador de CSS do EasyWeb
    -> folha complementar em @layer easyweb-ai
    -> verificação de estabilidade
    -> cache da adaptação compilada
```

A IA descreve o objetivo e seus parâmetros dentro do catálogo, por exemplo:

```json
{
  "type": "css-adjustment",
  "scope": "main-content",
  "parameters": {
    "rules": [
      {
        "property": "font-size-scale",
        "value": 1.16,
        "reason": "Texto de leitura abaixo do tamanho preferido"
      },
      {
        "property": "line-height",
        "value": 1.7,
        "reason": "Blocos extensos com espaçamento insuficiente"
      }
    ]
  }
}
```

O handler local resolve `main-content` na estrutura real da página, transforma
as propriedades declarativas em CSS permitido e adiciona a folha como
`@layer easyweb-ai`. Assim, uma adaptação pode ser aplicada cedo no
carregamento seguinte, mas continua sendo totalmente removível pelo EasyWeb.

O CSS complementar é apropriado para:

- escala tipográfica, espaçamento de leitura e largura de conteúdo;
- contraste de textos, links, botões, campos e bordas;
- foco de teclado, distinção de links e alvos clicáveis;
- redução de movimento e transições não essenciais;
- destaque ou redução visual de regiões secundárias;
- ajustes de apresentação ligados aos perfis de baixa visão, dislexia,
  daltonismo e sensibilidade visual.

CSS complementar não substitui componentes locais do EasyWeb. Recursos como
barra de leitura, menu alternativo, cartões para tabelas e formulários guiados
devem continuar sendo implementados por handlers locais e previsíveis. A IA
apenas pode solicitar esses componentes pelo tipo de ação correspondente.

#### Restrições do compilador de CSS

O compilador deve rejeitar o plano, ou remover somente a regra inválida, quando
ela tentar usar qualquer uma destas construções:

- `@import`, `@font-face`, `url()`, `content`, `behavior`, `expression` ou
  `javascript:`;
- `position: fixed`, `position: sticky` ou `z-index` elevado fora de
  componentes próprios do EasyWeb;
- `pointer-events: none`, interceptação de cursor ou regras que desativem
  controles do site;
- ocultação de `main`, `article`, formulários, mensagens de erro, conteúdo
  legal, avisos de segurança ou conteúdo original;
- regras globais destrutivas como `*`, `html` ou `body` com propriedades que
  possam esconder, bloquear rolagem ou inutilizar a página;
- seletores CSS criados pela IA na primeira versão;
- propriedades, valores, quantidade de regras, especificidade ou tamanho além
  dos limites definidos pelo catálogo.

O CSS final deve usar somente seletores e escopos escolhidos pelos detectores
locais do EasyWeb. Cada regra compilada deve manter referência à ação de origem,
justificativa, confiança, versão do handler e limites usados na validação.

## 13. Detecção local antes de chamar a IA

Antes de usar IA, o EasyWeb deve transformar o snapshot em diagnósticos objetivos. Exemplos:

| Diagnóstico | Evidência local |
| --- | --- |
| Contraste insuficiente | Relação calculada abaixo do mínimo definido. |
| Foco invisível | Elementos interativos não mudam de forma visível em `:focus-visible`. |
| Navegação muito densa | Muitos links equivalentes dentro de regiões de navegação. |
| Texto pouco legível | Fonte pequena, linha apertada ou blocos extensos. |
| Controles pequenos | Botões/campos abaixo do tamanho mínimo configurado. |
| Excesso de movimento | Animações, autoplay ou transições frequentes detectadas. |
| Conteúdo principal identificável | Presença de `main`, `article`, `role="main"` ou heurística local. |
| Formulário longo | Quantidade alta de campos distribuídos em uma mesma região. |
| Tabela densa | Muitas colunas ou células em viewport reduzido. |

A IA recebe esses sinais como evidência; não deve ser responsável por inventar problemas a partir de conteúdo pessoal.

## 14. Validação e reversão no navegador

### 14.1 Pré-validação do plano

Antes de qualquer alteração:

- validar JSON com schema local estrito;
- confirmar correspondência de `origin`, assinatura de snapshot, assinatura de
  adaptação, versão e expiração;
- rejeitar ações, parâmetros, escopos e níveis não permitidos;
- limitar quantidade de ações, tamanho total e custo estimado;
- bloquear planos incompatíveis com o perfil e preferências atuais;
- exigir confiança mínima diferente por nível: `0.70` para nível 1, `0.82` para nível 2 e `0.90` para nível 3.

### 14.2 Verificação após aplicação

Após cada grupo de ações, o EasyWeb verifica:

- se a região principal ainda está visível e ocupa área útil;
- se o número de elementos interativos não caiu de maneira inesperada;
- se não houve erro na extensão ou alteração repetitiva do DOM;
- se não há sobreposição severa, rolagem horizontal indevida ou tela aparentemente vazia;
- se foco de teclado continua alcançando links, botões e campos;
- se o handler respeitou seu limite de tempo e custo.

Uma falha remove o grupo de ações correspondente. Uma falha grave remove todo o plano e registra somente um motivo técnico local, como `layout-instability` ou `interactive-elements-lost`.

### 14.3 Reversão disponível ao usuário

O usuário sempre terá:

- **Desfazer agora**: remove o plano da aba atual;
- **Não usar IA neste site**: bloqueia novos planos para a origem;
- **Usar apenas ajustes básicos**: limita o site ao nível 1;
- **Voltar ao perfil global**: remove exceções de adaptação do site;
- **Limpar histórico local**: remove planos, prévias e avaliações armazenados.

## 15. Estado e armazenamento local

Sugestão de chaves, sujeita a implementação posterior:

| Chave | Conteúdo |
| --- | --- |
| `easyweb:ai-enabled` | Aceitação global do uso de planos de IA. |
| `easyweb:ai-max-level` | Nível máximo de adaptação permitido. |
| `easyweb:ai-preferences` | Preferências locais de experiência. |
| `easyweb:ai:site:<origin>` | Preferências, bloqueio e consentimento por origem. |
| `easyweb:ai:base-plan:<origin>:<adaptationFingerprint>` | Plano base validado, versão e expiração. |
| `easyweb:ai:personal-plan:<origin>:<profile>` | Plano pessoal válido apenas nesta instalação; pode ser direto ou complementar um plano base. |
| `easyweb:ai:compiled:<planId>` | CSS compilado e configuração serializável de um plano base ou pessoal. |
| `easyweb:ai:outcome:<origin>:<adaptationFingerprint>` | Resultado técnico e avaliação opcional. |

Nenhuma dessas chaves deve guardar snapshot bruto, textos da página, informações de formulário ou dados pessoais. O cache deve ter TTL e tamanho máximo definidos.

### 15.1 Cache de adaptações aprovadas

Depois que um plano de IA for validado e aplicado com sucesso, o EasyWeb deve
armazenar localmente duas representações separadas para o plano base e, quando
existir, para o delta pessoal:

1. **Plano validado:** o JSON original, escopo (`base` ou `personal`), versão,
   data de expiração, perfil, `origin`, assinatura de snapshot, assinatura de
   adaptação, resultado de validação e versão dos handlers. Um plano pessoal
   mantém o escopo da instalação e, quando existir, o `basePlanId` de contexto.
2. **Adaptação compilada:** somente a folha CSS e a configuração serializável
   produzidas pelos handlers locais do EasyWeb. Essa versão pronta pode entrar
   cedo no carregamento da página, sem solicitar a IA, a API ou recalcular toda
   a estratégia de adaptação.

Quando ambos existirem, a ordem de aplicação é fixa: primeiro a camada do plano
base e depois a camada pessoal. Um plano pessoal direto usa somente a camada
pessoal. O compilador usa camadas CSS separadas, por exemplo
`@layer easyweb-ai-base` e `@layer easyweb-ai-personal`, e rejeita um delta
pessoal que tente desfazer uma proteção obrigatória do plano base.

Na próxima visita, a extensão identifica a página pelo `origin` e por uma
**chave de bootstrap**. Quando a chave, a versão do plano, o perfil, as
preferências relevantes e a versão dos handlers coincidirem, ela pode inserir
cedo somente a adaptação compilada de **nível 1** em uma camada marcada como
`easyweb-ai-cache`. Essa aplicação é provisória: depois que a página estiver
disponível, o EasyWeb recalcula e compara a assinatura de adaptação completa.
Qualquer divergência remove a camada antes de habilitar ações mais complexas.
Planos de níveis 2 e 3 só são aplicados depois de a página alcançar o estado de
validação completo e de a autorização exigida estar confirmada. Isso reduz tempo
de processamento, elimina novas chamadas de IA para templates já conhecidos e
evita que a página fique aguardando uma resposta remota.

O cache deve ser ignorado e removido automaticamente quando ocorrer qualquer
uma destas condições:

- a assinatura de adaptação do site mudou ou não pode ser confirmada;
- o plano base ou o delta pessoal expirou, foi revogado ou falhou em validação posterior;
- o usuário mudou perfil, intensidade, nível máximo ou preferências que afetam
  a adaptação;
- a versão de um handler local mudou;
- o usuário desativou o modo Aprimorado, o uso de recomendações de IA, a
  adaptação daquele site ou o próprio EasyWeb;
- a validação de estabilidade detectar sobreposição, perda de interatividade,
  erro de aplicação ou regressão visual.

O cache nunca pode substituir o conteúdo do site, nem armazenar HTML, textos,
dados de formulário ou código gerado pela IA. Ele contém apenas a configuração
estruturada e os estilos que os handlers locais já comprovaram ser seguros.

## 16. Contratos futuros entre extensão e API

O WebSocket já serve para snapshots. A evolução pode usar as seguintes mensagens versionadas:

```json
{ "type": "easyweb:adaptation:lookup", "origin": "https://exemplo.gov.br", "adaptationFingerprint": "...", "profile": "elderly", "knownBasePlanId": "optional", "knownPersonalPlanId": "optional" }
```

```json
{ "type": "easyweb:adaptation:pending", "origin": "https://exemplo.gov.br", "adaptationFingerprint": "...", "stage": "awaiting-family-confidence|family-stable-no-opportunity|analyzing-base" }
```

```json
{ "type": "easyweb:adaptation:base-plan", "plan": { "schemaVersion": 1, "planScope": "base" } }
```

```json
{ "type": "easyweb:adaptation:personal-request", "origin": "https://exemplo.gov.br", "snapshot": { "captureVersion": 1 }, "basePlanId": null, "profile": "elderly", "preferences": { "adaptationIntensity": "balanced" }, "userRequest": { "text": "Não consigo ler esta página", "intentTags": ["reading-difficulty"] } }
```

```json
{ "type": "easyweb:adaptation:personal-plan", "plan": { "schemaVersion": 1, "planScope": "personal", "basePlanId": null } }
```

```json
{ "type": "easyweb:adaptation:outcome", "origin": "https://exemplo.gov.br", "adaptationFingerprint": "...", "planId": "...", "result": "applied|rolled-back|helpful|unhelpful", "technicalReason": "optional" }
```

O backend nunca deve transmitir instruções executáveis. Ele entrega apenas planos JSON previamente validados e associados à família de páginas correta. Mensagens de plano pessoal são enviadas apenas à conexão WebSocket que fez o pedido.

### 16.1 Persistência prevista na API

Além da tabela atual de snapshots protegidos, a API precisará de registros
separados para:

| Registro | Chave de associação | Conteúdo permitido |
| --- | --- | --- |
| Família de páginas | Origem e assinatura de adaptação | Hashes de snapshots compatíveis, similaridade e estado da análise. |
| Plano base | Família de páginas e versão | Plano JSON validado, versão de prompt/modelo, expiração e resultado de validação. |
| Resultado técnico do plano base | Família de páginas e `planId` base | Métricas agregadas e não pessoais de aplicação ou reversão. |

O texto livre enviado pelo usuário é usado apenas durante a solicitação pessoal
em tempo real. Depois de produzir, rejeitar ou não conseguir entregar o delta,
a API descarta o texto, o delta e os identificadores temporários. O MySQL não
guarda melhorias pessoais, CSS pessoal, prompt pessoal, histórico de pedido ou
resultado de aplicação pessoal; somente a extensão do usuário mantém esse cache
local.

## 17. Estados de interface

| Estado | Texto no popup | Ação disponível |
| --- | --- | --- |
| Modo Padrão | “A IA está desativada no modo Padrão.” | Abrir Mais configurações. |
| Sem consentimento global | “Ative a análise de IA nas configurações.” | Abrir Mais configurações. |
| Sem autorização do site | “Autorize este site para análise de IA.” | Switch de autorização. |
| Snapshot aguardando | “Preparando snapshot protegido.” | Cancelar autorização. |
| Snapshot sincronizado | “Estrutura recebida pela API.” | Capturar novamente. |
| Aguardando evidências | “A API está confirmando a estabilidade desta família de páginas.” | Continuar usando o EasyWeb normalmente. |
| Família estável sem oportunidade | “A API não identificou uma melhoria automática segura neste momento.” | Continuar usando o EasyWeb normalmente. |
| Comparando estrutura | “A API está verificando se as páginas pertencem à mesma família.” | Usar algoritmo padrão. |
| Análise base pendente | “A IA está preparando os ajustes comuns deste site.” | Usar algoritmo padrão. |
| Pedido pessoal enviado | “A análise considera a dificuldade informada por você.” | Cancelar ou usar algoritmo padrão. |
| Plano disponível | “Há ajustes sugeridos para este site.” | Ver resumo e prévia. |
| Plano base em prévia | “Prévia dos ajustes comuns deste site ativa nesta aba.” | Aplicar, desfazer. |
| Plano pessoal em prévia | “Prévia dos seus ajustes adicionais ativa nesta aba.” | Aplicar, desfazer. |
| Plano aplicado | “Experiência adaptativa ativa.” | Ver ajustes, desfazer. |
| Plano bloqueado | “A adaptação de IA está bloqueada neste site; o perfil normal do EasyWeb continua ativo.” | Remover bloqueio. |
| Reversão automática | “A adaptação foi removida para preservar o site.” | Ver detalhes técnicos. |

## 18. Avaliação sem coleta de conteúdo

Após uso suficiente de um plano, o popup pode exibir uma pergunta opcional e discreta:

**“Os ajustes facilitaram o uso desta página?”**

Opções:

- Ajudou;
- Não fez diferença;
- Atrapalhou;
- Desfazer e não usar neste site.

Para planos base, o envio opcional à API pode conter apenas origem transformada
em hash, assinatura de adaptação, versão do plano e motivo técnico agregado.
Avaliações, reversões e resultados de planos pessoais ficam somente na extensão.
Nenhum texto da página, clique individual ou dado pessoal deve ser enviado.

## 19. Critérios de qualidade

Um plano só é considerado pronto quando:

- respeita o schema e catálogo de ações;
- passa na validação local;
- mantém acesso ao conteúdo e layout original;
- pode ser revertido integralmente;
- oferece valor mensurável para o perfil escolhido;
- não cria dependência da API para o algoritmo padrão;
- é claro na interface sobre o que será alterado;
- permanece válido apenas para o template analisado;
- tem testes de regressão nos handlers envolvidos.

## 20. Fases de implementação propostas

### Fase 0: Especificação e protótipo visual

- Aprovar este documento.
- Desenhar os blocos futuros no popup e na página de configurações, sem ativar IA.
- Definir textos, estados, permissões e modelo de preferências.

### Fase 1: Executor local

- Criar catálogo de ações e handlers determinísticos de nível 1.
- Criar schema validator, mecanismo de camada adaptativa e reversão.
- Adicionar testes unitários e testes em páginas estáticas de referência.

### Fase 2: Diagnóstico local

- Calcular barreiras e capacidades de template sem IA.
- Exibir diagnóstico compreensível ao usuário.
- Validar se os diagnósticos correspondem ao resultado visual esperado.

### Fase 3: Contrato de API

- Versionar mensagens WebSocket de plano e resultado.
- Criar armazenamento de planos, expiração e associação por assinatura de
  adaptação, mantendo referência à assinatura de snapshot de origem.
- Manter a amostragem por família: duas amostras para estruturas estáticas,
  três para famílias dinâmicas, com limiar de similaridade, evidência independente
  e escore de oportunidade antes de chamar a IA para um plano base.
- Implementar API simulada que retorna planos fixos para testes.

### Fase 4: Integração de IA

- Implementar prompt fixo, tarefa estruturada e validação de resposta no backend.
- Registrar versão do modelo, prompt e schema para auditoria técnica.
- Liberar somente para templates com snapshot autorizado.
- Criar o fluxo em tempo real de pedido pessoal, delta privado e entrega pelo
  WebSocket da instalação solicitante.

### Fase 5: Experiência adaptativa avançada

- Introduzir ações de nível 2 com prévia obrigatória.
- Medir falhas e reversões.
- Só então avaliar nível 3 para tabelas e formulários, com testes específicos.

## 21. Decisões da implementação inicial

| Decisão | Estado atual |
| --- | --- |
| Provedor e processamento | Gemini, chamado somente pela API Node.js com uma chave configurada no ambiente. |
| Compartilhamento | Planos base são compartilháveis por origem e família estrutural. Deltas pessoais ficam somente na extensão solicitante. |
| Catálogo de nível 1 | Tipografia, espaçamento, foco, links, bordas de controles, redução de movimento, áreas de toque e CSS declarativo. |
| Aplicação inicial | Ajustes de nível 1 são aplicados automaticamente depois de validados; a prévia explícita permanece pendente. |
| Família de páginas | Similaridade estrutural mínima de `0.72`; estruturas estáticas exigem ao menos duas amostras e dinâmicas, três, além de evidência independente e confiança suficiente. |
| Limites de frequência | Um snapshot por página e template confirmado; o servidor rejeita novas capturas no mesmo socket antes de três segundos e pedidos pessoais antes de quinze segundos. |
| Planos de alto impacto | Níveis 2 e 3 continuam desativados, sem revisão humana ou execução de componentes avançados. |

O nível atual possui retenção de snapshots configurável pela API, exclusão sob demanda pelo identificador local da extensão e limpeza de planos/famílias que perderem suas fontes. Antes de uma publicação ampla, ainda será necessário definir o tempo máximo de resposta e as regras da prévia/reversão automática.

## 22. Estado da implementação inicial

O executor declarativo de nível 1 foi iniciado com as ações de tipografia,
espaçamento, foco, links, limites visuais de controles, redução de movimento,
áreas de toque e ajustes CSS declarativos. A API usa Gemini com saída JSON
estruturada, remove qualquer ação fora do catálogo e grava apenas planos base
derivados de uma família estrutural compatível e confiável. A extensão compila os planos
em CSS próprio, cacheia o resultado localmente e nunca executa código fornecido
pelo modelo.

Ainda faltam, antes de considerar o recurso completo: prévia com confirmação
explícita, validação visual pós-aplicação, métricas agregadas, reversão por
grupo de ações, limites de frequência para pedidos pessoais e os handlers de
níveis 2 e 3.
