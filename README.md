# EasyWeb

> Tornando a Web mais democrática e acessível para todas as pessoas.

![Versão](https://img.shields.io/badge/versão-0.1.0--development-00a99d?style=flat-square)
![Licença](https://img.shields.io/badge/licença-MIT-2563eb?style=flat-square)
![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)

O EasyWeb é um projeto open source de acessibilidade para a Web. O repositório contém uma extensão para o Google Chrome e uma API Node.js que dá suporte ao modo adaptativo opcional.

## Visão geral

O projeto pode:

- ajustar leitura, contraste, links, foco, movimento e filtros de cor nas páginas Web;
- salvar perfis globais e exceções específicas de cada site somente no navegador da pessoa;
- enviar, com consentimento, snapshots estruturais protegidos para a API no modo Aprimorado;
- gerar planos declarativos reutilizáveis, sem executar JavaScript, HTML ou CSS arbitrário recebido da IA.

## Estrutura do repositório

```text
EasyWeb/
├── EasyWeb Extension/  # Extensão Chrome baseada no Manifest V3
├── EasyWeb API/        # API REST e WebSocket em Node.js
├── README.md
├── LICENSE
└── .gitignore
```

## Usar a extensão no Chrome

1. Abra `chrome://extensions` no Google Chrome.
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta `EasyWeb Extension` deste repositório.
5. Abra uma página Web e clique no ícone do EasyWeb para ativar os ajustes.

Na página de configurações, é possível escolher perfis globais, selecionar o modo Padrão ou Aprimorado e administrar o consentimento para snapshots.

## Executar a API localmente

Requisitos:

- Node.js 20 ou superior;
- MySQL compatível, caso você queira armazenar snapshots e planos base.

```powershell
cd "EasyWeb API"
npm install
Copy-Item .env.example .env
# Edite .env e preencha as variáveis MYSQL_* e GEMINI_API_KEY quando necessário.
npm run dev       # desenvolvimento, com reinício automático
```

Para executar sem o modo de observação:

```powershell
npm start
```

Por padrão, a API usa `http://127.0.0.1:3001` e o WebSocket usa `ws://127.0.0.1:3001/ws`. Para conectar a extensão à API local, ative o Modo do desenvolvedor nas configurações da extensão e informe essa URL.

Nunca envie ao repositório o arquivo `.env`, chaves Gemini, senhas MySQL ou tokens do painel técnico.

## Privacidade e IA

O modo Aprimorado exige consentimento global e também pode exigir consentimento por site. O snapshot contém apenas a estrutura da página, metadados de estilo e informações agregadas de scripts. Textos, atributos, valores de formulários, cookies, credenciais e código JavaScript não fazem parte do payload persistido.

Quando habilitada, a IA recebe snapshots protegidos e devolve um plano limitado a presets conhecidos, como legibilidade, foco, espaçamento e limites visuais de controles. A extensão valida o plano e compila sua própria camada CSS. Planos base podem ser armazenados pela API; pedidos pessoais permanecem apenas na extensão que os solicitou.

## Testes

```powershell
# Extensão
cd "EasyWeb Extension"
node --test test\*.test.js

# API
cd "..\EasyWeb API"
npm test
```

Consulte o README e os documentos de cada projeto para detalhes de arquitetura, configuração e protocolo WebSocket.

## Contribuir

Antes de abrir uma pull request:

1. Mantenha as alterações focadas e documente mudanças de comportamento.
2. Execute os testes do componente alterado.
3. Nunca inclua dados de navegação, snapshots reais, arquivos `.env` ou chaves de API.
4. Para mudanças no contrato de IA, preserve o executor limitado e reversível.

Para relatar vulnerabilidades ou problemas que possam expor dados de navegação, não publique informações sensíveis nas issues.

## Licença

Este projeto é distribuído sob a [Licença MIT](LICENSE).
