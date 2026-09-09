# EasyWeb

**Tornando a Web mais democrática e acessível para todos.**

Extensão para Google Chrome que permite adaptar visualmente páginas da Web de forma simples, manual e reversível.

## Sobre o projeto

O EasyWeb foi criado para ajudar a reduzir barreiras como textos pequenos, baixo contraste, espaçamento inadequado e navegação confusa.

A proposta foi apresentada na 4ª Feira de Ciência, Tecnologia & Inovação de Rio Claro e Região, dentro do Programa Hub nas Escolas 2026.

## Protótipo atual

Versão: `0.1.0-development`

O protótipo combina uma página completa de configurações com um popup para ajustes rápidos na aba atual.

Na página de configurações, o usuário escolhe um perfil global:

- **Padrão:** ajustes manuais individualmente por site;
- **Idoso:** texto maior, espaçamento ampliado, contraste e links destacados;
- **Crianças:** leitura mais confortável, contraste e links destacados;
- **PCD:** espaçamento, contraste e navegação visual reforçados;
- **Daltônico:** ajustes de leitura com filtro de cores configurável.

O popup permite personalizar a página atual sem alterar o perfil global:

- aumentar ou reduzir o tamanho do texto;
- ajustar o espaçamento entre linhas;
- ajustar o espaçamento entre letras;
- ativar o alto contraste;
- usar contraste assistido, ajustando apenas textos com contraste insuficiente;
- destacar links;
- ativar o filtro para daltonismo por site ou globalmente, com protanopia/protanomalia, deuteranopia/deuteranomalia, tritanopia/tritanomalia, acromatopsia, acromatomalia e monocromacia de cones azuis;
- ativar o **Carregamento Rápido (Experimental)** em páginas estáveis;
- desativar os ajustes;
- restaurar a aparência original.

As preferências manuais são salvas localmente por site e reaplicadas quando a página é aberta novamente. O filtro universal é configurado na página de configurações e o botão de restauração pode remover o ajuste global do perfil ou somente a personalização do site atual.

Quando uma preferência salva é aplicada pela primeira vez na sessão da aba, uma notificação discreta aparece no canto superior direito e desaparece automaticamente após 3 segundos. Ela não se repete durante a navegação pelo mesmo site.

## Instalação

1. Abra o Google Chrome.
2. Acesse `chrome://extensions`.
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta `C:\EasyWeb Extension`.

Depois, abra uma página comum da Web e clique no ícone da EasyWeb.

## Como testar

1. Abra uma página com textos e links.
2. Abra a EasyWeb pelo ícone do Chrome.
3. Altere qualquer controle e observe a página.
4. Abra **Mais configurações** para escolher um perfil global.
5. Teste o alto contraste, o destaque de links e o filtro para daltonismo.
6. Clique em **Restaurar aparência original**.

Recomendamos testar em notícias, lojas, formulários, páginas responsivas e aplicações de página única.

## Estrutura

```text
EasyWeb Extension/
├── manifest.json          # Configuração da extensão
├── popup.html              # Interface do popup
├── options.html            # Página completa de configurações
├── src/
│   ├── options.js          # Perfis e configurações universais
│   ├── popup.js            # Controles do popup
│   ├── content.js          # Orquestração na página
│   ├── background.js        # Propagação de perfis para as abas abertas
│   └── handlers/           # Responsabilidades separadas
│       ├── accessibility-handler.js
│       ├── color-filter-handler.js
│       ├── contrast-handler.js
│       ├── fast-mode-handler.js
│       ├── fast-style-bootstrap.js
│       ├── link-handler.js
│       ├── notification-handler.js
│       ├── page-handler.js
│       └── settings-handler.js
└── styles/
    ├── popup.css           # Estilos do popup
    ├── options.css          # Estilos da página de configurações
    └── content.css         # Estilos aplicados às páginas
```

## Como a extensão funciona

1. O Chrome carrega o script da EasyWeb em páginas web compatíveis.
2. O handler de configurações verifica se existem preferências salvas para o site atual.
3. O serviço em segundo plano atualiza todas as abas abertas quando um perfil global muda.
4. O handler de acessibilidade aplica as preferências automaticamente.
5. O usuário escolhe um perfil global na página de configurações ou abre o popup para alterar a página atual.
6. Os ajustes manuais são salvos localmente para aquele site e têm prioridade naquele site.
7. O usuário pode restaurar a aparência original e remover o ajuste salvo.

Os handlers mantêm a persistência, a comunicação com a aba, a notificação, o contraste, os links e o redimensionamento isolados. Isso facilita testar, corrigir e evoluir cada parte sem concentrar toda a lógica em um único arquivo.

O Carregamento Rápido é uma otimização por página. Depois da primeira aplicação, ele gera uma folha CSS da própria EasyWeb e a guarda na sessão com uma assinatura estrutural da página. Em uma nova abertura, os estilos-base entram no início do carregamento; as regras específicas de fonte, contraste e controles só entram depois que a assinatura do DOM é confirmada. Se a estrutura não corresponder, o cache é descartado e o algoritmo normal é usado. Antes de liberar o switch, a EasyWeb mede o tamanho e as alterações do DOM; páginas dinâmicas ou grandes demais mantêm o controle desativado. O modo não altera o cache HTTP ou os arquivos CSS originais do site.

O destaque de links adiciona sublinhado e, ao passar o mouse ou navegar com o teclado, aplica uma marcação amarela de alto contraste sem alterar o layout. O alto contraste calcula a relação de contraste entre cada texto e seu fundo e escolhe preto ou branco conforme o melhor resultado. O cálculo considera transparência e opacidade para tratar também textos auxiliares, títulos, rótulos e links. Ele também ajusta a cor das bordas de botões e campos de formulário, seus placeholders, e cria um contorno interno quando o controle não possui borda visível. Elementos com fundos de imagem ou transparências difíceis de interpretar são preservados, assim como imagens, vídeos, canvas, SVGs e o layout geral da página.

## Próximos passos

O banner do projeto prevê uma evolução gradual:

1. Testar o protótipo com diferentes páginas e usuários.
2. Criar uma base de dados de barreiras e soluções de acessibilidade.
3. Avaliar inteligência artificial para identificar problemas e sugerir ajustes no HTML e no CSS.

Esses recursos ainda não fazem parte da versão atual.

## Limitações

- Algumas páginas protegidas pelo Chrome não permitem alterações.
- Arquivos locais podem exigir uma autorização adicional no Chrome.
- As preferências são armazenadas somente neste navegador e não são sincronizadas.
- O protótipo ainda não substitui uma avaliação completa de acessibilidade.
- Não há banco de dados, cadastro ou inteligência artificial nesta versão.

## Desenvolvimento

O projeto usa **Manifest V3**. O Chrome exige que `version` seja numérica, por isso o manifesto utiliza:

```json
"version": "0.1.0",
"version_name": "0.1.0-development"
```

## Licença

A licença ainda não foi definida.
