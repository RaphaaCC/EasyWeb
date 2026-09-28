# EasyWeb

> Tornando a Web mais democrática e acessível para todas as pessoas.

![Versão](https://img.shields.io/badge/versão-v1.0.7%20Beta-00a99d?style=flat-square)
![Licença](https://img.shields.io/badge/licença-MIT-2563eb?style=flat-square)
![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
[![Instalar no Chrome](https://img.shields.io/badge/Chrome_Web_Store-Instalar_EasyWeb-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/easyweb/pjkepibklnkhefipagfnkncpnmmnljpl)

O EasyWeb é um projeto open source de acessibilidade para a Web. O repositório contém uma extensão para o Google Chrome e uma API Node.js que dá suporte ao modo adaptativo opcional.

**[Instale o EasyWeb pela Chrome Web Store](https://chromewebstore.google.com/detail/easyweb/pjkepibklnkhefipagfnkncpnmmnljpl)** para começar. Não é necessário baixar este repositório, instalar Node.js ou executar uma API para usar a extensão.

A versão indicada neste README é a do código deste repositório. A versão disponível na loja pode ser diferente durante a revisão de uma atualização.

## Visão geral

O projeto pode:

- ajustar leitura, contraste, links, foco, movimento e filtros de cor nas páginas Web;
- salvar perfis globais e exceções específicas de cada site somente no navegador da pessoa;
- enviar, com consentimento, snapshots estruturais protegidos para a API no modo Aprimorado;
- gerar planos declarativos reutilizáveis, sem executar JavaScript, HTML ou CSS arbitrário recebido da IA.

## Usar a extensão no Chrome

1. Acesse a [página oficial do EasyWeb](https://chromewebstore.google.com/detail/easyweb/pjkepibklnkhefipagfnkncpnmmnljpl) e clique em **Usar no Chrome**.
2. Confirme a instalação e fixe o EasyWeb no menu de extensões para facilitar o acesso.
3. Abra um site, clique no ícone do EasyWeb e ative **Ativar EasyWeb**.
4. Em **Mais configurações**, escolha o perfil que será aplicado aos sites.
5. Para personalizar somente o site aberto, ative **Configurações manuais para este site** no popup.

Na página de configurações, é possível escolher perfis globais, selecionar o modo Padrão ou Aprimorado e administrar o consentimento para snapshots.

Os perfis disponíveis são Padrão, Idoso, Crianças, Dislexia, Baixa visão, Sensibilidade visual e Leitura focada. O filtro para daltonismo é independente do perfil. Dislexia usa a fonte OpenDyslexic incluída na extensão, também disponível nos ajustes manuais de cada site. As preferências manuais substituem o perfil global naquele site.

### Modos de funcionamento

| Modo | Funcionamento |
| --- | --- |
| **Padrão** | Aplica os ajustes locais do EasyWeb, sem depender da API ou da IA. |
| **Aprimorado** | Conecta à API e permite snapshots autorizados e adaptações de IA. Pedidos pessoais podem ser feitos pelo popup. |

Os modos podem ser alterados no popup e na página de configurações. O Chrome restringe a atuação de extensões em páginas internas e na própria Chrome Web Store.

## Desenvolver localmente

```text
EasyWeb/
├── EasyWeb Extension/  # Extensão Chrome baseada no Manifest V3
├── EasyWeb API/        # API REST e WebSocket em Node.js
├── PRIVACY.md          # Política de privacidade
├── README.md
└── LICENSE
```

### Carregar a extensão pelo código

1. Clone este repositório ou baixe e extraia seu código.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor** do Chrome.
3. Clique em **Carregar sem compactação** e selecione a pasta `EasyWeb Extension`.
4. Após editar os arquivos, recarregue a extensão nessa página e atualize as abas dos sites.

A extensão não precisa de `node_modules` para funcionar no Chrome. As dependências de desenvolvimento são usadas nas verificações do projeto.

### Executar a API localmente

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

Por padrão, a API usa `http://127.0.0.1:3001` e o WebSocket usa `ws://127.0.0.1:3001/ws`. Para conectar a extensão à API local, ative o **Modo Desenvolvedor** nas configurações do EasyWeb e informe `http://127.0.0.1:3001` como endereço da API. Esse controle é separado do modo do desenvolvedor do Chrome.

Consulte o [guia da API](EasyWeb%20API/README.md) para as variáveis de ambiente e os controles de acesso ao WebSocket.

Nunca envie ao repositório o arquivo `.env`, chaves Gemini, senhas MySQL ou tokens do painel técnico.

## Privacidade e IA

O modo Aprimorado exige consentimento global e autorização individual para cada site. O snapshot contém apenas a estrutura da página, metadados de estilo e informações agregadas de scripts. Textos, atributos, valores de formulários, cookies, credenciais e código JavaScript não fazem parte do payload persistido.

Quando habilitada, a IA recebe snapshots protegidos e devolve um plano limitado a presets conhecidos, como legibilidade, títulos, navegação, formulários, foco, espaçamento, controles visualmente maiores e cores de texto de uma paleta segura. A extensão valida o plano e compila sua própria camada CSS. As chamadas ao Gemini entram em uma fila serial, com prioridade para pedidos pessoais do popup; planos base podem ser armazenados pela API, enquanto pedidos pessoais permanecem apenas na extensão que os solicitou.

Leia a [Política de Privacidade](PRIVACY.md) para entender quais dados podem ser salvos localmente, enviados à API e processados por IA.

## Testes

```powershell
# Extensão
cd "EasyWeb Extension"
npm install
npm test

# API
cd "..\EasyWeb API"
npm test

# Navegador (Playwright, extensão carregada sem compactação)
cd "..\EasyWeb Extension"
npm run test:e2e
```

Para detalhes da experiência adaptativa, consulte o [planejamento de IA](EasyWeb%20Extension/docs/AI_ADAPTIVE_EXPERIENCE_PLAN.md).

## Contribuir

Antes de abrir uma pull request:

1. Mantenha as alterações focadas e documente mudanças de comportamento.
2. Execute os testes do componente alterado.
3. Nunca inclua dados de navegação, snapshots reais, arquivos `.env` ou chaves de API.
4. Para mudanças no contrato de IA, preserve o executor limitado e reversível.

Para relatar vulnerabilidades ou problemas que possam expor dados de navegação, não publique informações sensíveis nas issues.

Sugestões e bugs podem ser registrados nas [issues do projeto](https://github.com/RaphaaCC/EasyWeb/issues). Informe a versão, o comportamento esperado e como reproduzir o problema, sem incluir dados pessoais.

## Licença

Este projeto é distribuído sob a [Licença MIT](LICENSE).

A fonte OpenDyslexic incluída na extensão tem licença própria [SIL Open Font License 1.1](EasyWeb%20Extension/assets/fonts/OFL.txt), com [origem e créditos](EasyWeb%20Extension/assets/fonts/README.md).
