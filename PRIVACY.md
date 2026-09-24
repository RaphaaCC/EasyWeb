# Política de Privacidade do EasyWeb

Última atualização: 24 de setembro de 2026

O EasyWeb é uma extensão de acessibilidade para o Google Chrome. A extensão aplica ajustes visuais em páginas da Web e, quando o usuário ativa o modo Aprimorado, pode usar snapshots estruturais protegidos para gerar adaptações de acessibilidade com apoio de IA.

## Dados que a extensão salva localmente

A extensão pode salvar no navegador do usuário:

- preferências de acessibilidade;
- perfil global selecionado;
- configurações manuais por site;
- consentimentos de snapshot por site;
- URL da API no Modo Desenvolvedor;
- adaptações de acessibilidade em cache.

Esses dados são usados para manter a experiência configurada pelo usuário entre sessões de navegação.

## Dados enviados para a API

No modo Padrão, a extensão não envia snapshots de páginas para a API.

No modo Aprimorado, a extensão só envia snapshots quando:

1. o EasyWeb está ativado;
2. o modo Aprimorado está ativado;
3. o consentimento global para snapshots está ativado;
4. o site atual foi autorizado pelo usuário.

O snapshot é usado para analisar a estrutura visual da página e gerar adaptações de acessibilidade. Ele pode incluir:

- origem e caminho sanitizado da página;
- árvore estrutural da página;
- HTML estrutural sanitizado;
- CSS sanitizado;
- metadados agregados de estilos;
- metadados agregados de scripts.

## Dados que não coletamos

O EasyWeb não coleta intencionalmente:

- senhas;
- cookies;
- tokens de autenticação;
- valores digitados em formulários;
- dados de cartão ou pagamento;
- conteúdo textual pessoal da página;
- histórico geral de navegação;
- corpos de requisições ou respostas;
- localStorage ou sessionStorage;
- código JavaScript executável da página.

Campos e formulários sensíveis são removidos antes do envio do snapshot. A API também valida e sanitiza novamente os snapshots recebidos.

## Uso de IA

Quando o modo Aprimorado está ativo e autorizado, snapshots protegidos podem ser enviados para serviços de IA usados pelo EasyWeb, como o Gemini, para gerar adaptações de acessibilidade.

A IA deve retornar planos de adaptação limitados e validados. A extensão não deve executar JavaScript remoto recebido da API ou da IA. As adaptações são aplicadas pela própria extensão de forma controlada e reversível.

## Compartilhamento de dados

O EasyWeb não vende dados do usuário.

Snapshots protegidos podem ser processados pela API do EasyWeb e por serviços de IA usados para fornecer a funcionalidade de acessibilidade. Esses dados são usados apenas para operar e melhorar a experiência adaptativa da extensão.

## Retenção e remoção

Snapshots enviados ao servidor podem ser armazenados para permitir comparação estrutural entre páginas do mesmo site e reutilização de adaptações.

O usuário pode remover consentimentos e solicitar a remoção dos snapshots associados à sua instalação pelas configurações da extensão, quando a API estiver conectada.

Configurações locais e adaptações em cache podem ser removidas pelo usuário ao limpar os dados da extensão no Chrome.

## Segurança

A comunicação com a API de produção usa conexões seguras. O Modo Desenvolvedor permite configurar uma URL local ou personalizada para testes.

O projeto também evita registrar chaves de API, senhas, tokens, snapshots reais e arquivos `.env` no repositório.

## Contato

Para relatar problemas de privacidade ou segurança, abra uma issue no repositório oficial:

https://github.com/RaphaaCC/EasyWeb
