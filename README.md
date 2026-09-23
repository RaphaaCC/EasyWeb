# EasyWeb

> Tornando a Web mais democratica e acessivel para todos.

EasyWeb e uma plataforma open source de acessibilidade para a Web. O
repositorio contem uma extensao para Google Chrome e uma API Node.js que apoia
o modo adaptativo opcional.

## O que o projeto faz

- Aplica ajustes locais de leitura, contraste, links, foco, movimento e filtros
  de cor em paginas Web.
- Oferece perfis globais e excecoes manuais por site, salvos somente no
  navegador da pessoa.
- Inclui um modo Aprimorado opcional: com consentimento, a extensao envia
  snapshots estruturais protegidos para a API preparar planos de acessibilidade
  reutilizaveis.
- Aplica apenas planos declarativos validados. A extensao nao executa
  JavaScript, HTML ou CSS arbitrario retornado por IA.

## Estrutura

```text
EasyWeb/
|- EasyWeb Extension/  # Extensao Chrome Manifest V3
|- EasyWeb API/        # API REST e WebSocket em Node.js
|- README.md
|- LICENSE
`- .gitignore
```

## Comecar pela extensao

1. Abra `chrome://extensions` no Google Chrome.
2. Ative o Modo do desenvolvedor.
3. Clique em `Carregar sem compactacao`.
4. Selecione a pasta `EasyWeb Extension` deste repositorio.
5. Abra uma pagina Web e use o icone EasyWeb para ativar ajustes manuais.

A pagina de configuracoes da extensao permite escolher perfis globais,
configurar o modo Padrao ou Aprimorado e administrar o consentimento de
snapshots.

## Executar a API localmente

Requisitos: Node.js 20+ e, para snapshots e planos base, um MySQL compativel.

```powershell
cd "EasyWeb API"
npm install
Copy-Item .env.example .env
# Preencha as variaveis MYSQL_* e GEMINI_API_KEY quando necessario.
npm start
```

Por padrao, a API usa `http://127.0.0.1:3001` e o WebSocket
`ws://127.0.0.1:3001/ws`. Na extensao, ative o Modo Desenvolvedor para apontar
para essa URL local.

Nao envie o arquivo `.env`, chaves Gemini, senhas MySQL ou tokens de painel ao
repositorio.

## Privacidade e IA

O modo Aprimorado depende de consentimento global e por site. O snapshot e
reduzido a estrutura da pagina, metadados de estilo e informacoes agregadas de
scripts. Textos, atributos, valores de formularios, cookies, credenciais e
codigo JavaScript nao fazem parte do payload persistido.

Quando habilitada, a IA recebe snapshots protegidos e devolve um plano
declarativo limitado a presets conhecidos, como legibilidade, foco, espacamento
e limites visuais de controles. A extensao valida o plano e compila a propria
camada CSS. Planos base podem ser armazenados pela API; pedidos pessoais ficam
somente na extensao solicitante.

## Desenvolvimento e testes

```powershell
# Extensao
cd "EasyWeb Extension"
node --test test\*.test.js

# API
cd "..\EasyWeb API"
npm test
```

Consulte os READMEs e documentos dentro de cada projeto para detalhes de
arquitetura, configuracao e protocolo WebSocket.

## Contribuir

Contribuicoes sao bem-vindas. Antes de abrir uma pull request:

1. Mantenha as alteracoes focadas e documente mudancas de comportamento.
2. Execute os testes do componente alterado.
3. Nunca inclua dados de navegacao, snapshots reais, arquivos `.env` ou chaves
   de API.
4. Para mudancas no contrato de IA, preserve o executor limitado e reversivel.

Para relatar vulnerabilidades ou problemas que exponham dados de navegacao,
nao publique dados sensiveis em issues.

## Licenca

Este projeto e distribuido sob a [Licenca MIT](LICENSE).
