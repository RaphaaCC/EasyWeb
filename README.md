# EasyWeb

> Tornando a Web mais democrática e acessível para todos.

EasyWeb é uma extensão para Google Chrome criada para reduzir barreiras de acessibilidade em páginas da Web. A proposta é permitir que cada pessoa adapte visualmente uma página de acordo com suas necessidades, sem depender de conhecimentos técnicos e sem exigir alterações no site original.

Este repositório contém o primeiro protótipo funcional do projeto, na versão `0.1.0-development`.

## Contexto do projeto

O projeto foi apresentado no contexto da 4ª Feira de Ciência, Tecnologia & Inovação de Rio Claro e Região e do Programa Hub nas Escolas 2026, conforme o material de apresentação do EasyWeb.

O banner identifica como problema situações comuns na Web, como:

- baixo contraste;
- textos pequenos;
- espaçamento inadequado;
- navegação confusa;
- estruturas incompatíveis com tecnologias assistivas.

Essas barreiras podem dificultar o acesso de pessoas idosas, pessoas com deficiência, crianças e qualquer pessoa que encontre dificuldades para ler ou navegar por determinados sites.

## Proposta

O EasyWeb pretende adaptar a apresentação de páginas existentes para tornar a leitura e a navegação mais claras, seguras e acessíveis. A visão de longo prazo combina controles de personalização com análise inteligente das páginas, sempre com foco na autonomia do usuário.

O protótipo atual começa pela parte mais importante para validação: controles manuais, imediatos e reversíveis. A inteligência artificial, o registro de soluções por site e as recomendações automáticas fazem parte da evolução planejada, mas ainda não estão implementados.

## O que já funciona

Ao abrir a extensão em uma página compatível, o usuário pode ajustar:

- tamanho do texto, entre 80% e 160%;
- espaçamento entre linhas;
- espaçamento entre letras;
- modo de alto contraste;
- destaque visual de links;
- ativação ou desativação dos ajustes;
- restauração da aparência original.

As alterações são aplicadas somente à aba atual e podem ser desfeitas a qualquer momento. Nesta versão, as preferências ainda não são salvas após o recarregamento da página.

## Como funciona

O projeto usa Manifest V3 e possui uma estrutura pequena:

```text
EasyWeb Extension/
├── manifest.json
├── popup.html
├── src/
│   ├── content.js
│   └── popup.js
└── styles/
    ├── content.css
    └── popup.css
```

### `manifest.json`

Define a extensão, sua identidade, a versão, o popup, as permissões e a execução dos scripts nas páginas web.

O Chrome exige que o campo `version` use um formato numérico. Por isso, o projeto usa:

- `version`: `0.1.0`;
- `version_name`: `0.1.0-development`.

### `popup.html` e `styles/popup.css`

Formam a interface de controle exibida quando o usuário clica no ícone da extensão. O popup apresenta os controles de acessibilidade e envia cada alteração imediatamente para a aba ativa.

### `src/popup.js`

Lê os controles do popup, identifica a aba atual e envia as configurações para o script que está executando na página. Também possui uma tentativa de injeção sob demanda para páginas que já estavam abertas quando a extensão foi carregada.

### `src/content.js`

Recebe as configurações e aplica os ajustes no conteúdo da página. O script registra os tamanhos originais dos textos para que a restauração seja possível e observa novos elementos adicionados por páginas dinâmicas.

### `styles/content.css`

Contém os estilos aplicados à página, incluindo espaçamento, alto contraste e destaque de links. Os ajustes são ativados por classes adicionadas ao elemento raiz do documento.

## Instalação local

1. Abra `chrome://extensions` no Google Chrome.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione o diretório `C:\EasyWeb Extension`.
5. Abra uma página comum `http` ou `https` e clique no ícone da EasyWeb.

Se a extensão for recarregada enquanto uma página já estiver aberta, pode ser necessário atualizar essa página para que o script seja executado normalmente.

## Teste manual do protótipo

Para verificar o fluxo principal:

1. Abra uma página com textos, links e formulários.
2. Abra o popup da EasyWeb.
3. Mova o controle de tamanho do texto.
4. Aumente o espaçamento entre linhas ou letras.
5. Ative o alto contraste e o destaque de links.
6. Desative os ajustes ou clique em **Restaurar aparência original**.
7. Confirme que a página continua navegável e que os ajustes são removidos.

É importante testar em páginas com diferentes estruturas, incluindo notícias, lojas, formulários, páginas responsivas e aplicações de página única.

## Limitações conhecidas

O protótipo foi deliberadamente mantido pequeno para validar a experiência antes de criar recursos mais complexos:

- as configurações não são persistidas;
- não há análise por inteligência artificial;
- não há banco de dados de soluções por site;
- a extensão não altera o conteúdo semântico da página;
- algumas páginas especiais ou protegidas pelo Chrome podem não permitir a aplicação dos ajustes;
- o alto contraste é uma primeira aproximação visual e precisará de testes de acessibilidade mais amplos.

## Próximas etapas

A evolução planejada, alinhada à proposta apresentada no banner, é:

1. Testar o protótipo manual em páginas reais e com usuários com diferentes necessidades.
2. Melhorar a preservação de layouts, imagens, formulários e componentes interativos.
3. Salvar preferências por site, permitindo que o usuário reutilize seus ajustes.
4. Criar uma base de dados de barreiras e soluções observadas em diferentes páginas.
5. Avaliar o uso de inteligência artificial para identificar problemas e sugerir ajustes no HTML e no CSS.
6. Medir legibilidade, contraste, espaçamento e facilidade de navegação antes e depois das adaptações.

Cada etapa deve ser validada para evitar que uma melhoria visual prejudique a navegação, a compreensão do conteúdo ou o uso de tecnologias assistivas.

## Princípios do projeto

- **Autonomia:** o usuário decide quais ajustes deseja aplicar.
- **Reversibilidade:** qualquer alteração deve poder ser desfeita.
- **Compatibilidade:** a página original deve continuar utilizável.
- **Simplicidade:** os controles devem ser compreensíveis sem conhecimento técnico.
- **Acessibilidade real:** decisões futuras devem ser verificadas com padrões e testes, não apenas pela aparência.

## Licença

A licença ainda não foi definida para esta versão de desenvolvimento.
