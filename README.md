# EasyWeb

**Tornando a Web mais democrática e acessível para todos.**

Extensão para Google Chrome que permite adaptar visualmente páginas da Web de forma simples, manual e reversível.

## Sobre o projeto

O EasyWeb foi criado para ajudar a reduzir barreiras como textos pequenos, baixo contraste, espaçamento inadequado e navegação confusa.

A proposta foi apresentada na 4ª Feira de Ciência, Tecnologia & Inovação de Rio Claro e Região, dentro do Programa Hub nas Escolas 2026.

## Protótipo atual

Versão: `0.1.0-development`

O protótipo aplica ajustes somente na aba atual. O usuário controla tudo pelo popup da extensão:

- aumentar ou reduzir o tamanho do texto;
- ajustar o espaçamento entre linhas;
- ajustar o espaçamento entre letras;
- ativar o alto contraste;
- destacar links;
- desativar os ajustes;
- restaurar a aparência original.

As configurações ainda não são salvas depois que a página é recarregada.

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
4. Teste o alto contraste e o destaque de links.
5. Clique em **Restaurar aparência original**.

Recomendamos testar em notícias, lojas, formulários, páginas responsivas e aplicações de página única.

## Estrutura

```text
EasyWeb Extension/
├── manifest.json          # Configuração da extensão
├── popup.html              # Interface do popup
├── src/
│   ├── popup.js            # Controles e comunicação com a página
│   └── content.js          # Aplicação dos ajustes na página
└── styles/
    ├── popup.css           # Estilos do popup
    └── content.css         # Estilos aplicados às páginas
```

## Como a extensão funciona

1. O Chrome carrega o script da EasyWeb em páginas web compatíveis.
2. O usuário abre o popup e escolhe os ajustes.
3. O popup envia as configurações para a aba atual.
4. O script de conteúdo aplica os ajustes sem alterar permanentemente o site.
5. O usuário pode restaurar a aparência original a qualquer momento.

## Próximos passos

O banner do projeto prevê uma evolução gradual:

1. Testar o protótipo com diferentes páginas e usuários.
2. Salvar preferências para reutilizá-las em cada site.
3. Criar uma base de dados de barreiras e soluções de acessibilidade.
4. Avaliar inteligência artificial para identificar problemas e sugerir ajustes no HTML e no CSS.

Esses recursos ainda não fazem parte da versão atual.

## Limitações

- Algumas páginas protegidas pelo Chrome não permitem alterações.
- Arquivos locais podem exigir uma autorização adicional no Chrome.
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
