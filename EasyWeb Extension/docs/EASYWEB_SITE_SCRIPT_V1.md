# EasyWebSiteScriptV1

## Objetivo

`EasyWebSiteScriptV1` e o contrato de adaptacao usado entre a API, o Gemini e
a extensao. O nome representa um script de adaptacao por site, mas ele e um
objeto declarativo: a IA nunca devolve JavaScript executavel, CSS bruto,
seletores, URLs ou HTML.

A IA escolhe passos limitados. O interpretador, os seletores e o CSS final sao
propriedade da extensao, o que deixa a adaptacao reversivel, testavel e segura
para reutilizar no cache.

## Formato

Cada plano recebido pela extensao inclui `siteScript`:

```json
{
  "schemaVersion": 1,
  "planId": "base:example.com:abc:v1",
  "planScope": "base",
  "origin": "https://example.com",
  "siteScript": {
    "version": 1,
    "triggers": ["document-ready", "route-change"],
    "steps": [
      {
        "type": "apply-style",
        "target": "main-content",
        "preset": "readable-text",
        "parameters": { "scale": 1.15 }
      },
      {
        "type": "apply-style",
        "target": "interactive-elements",
        "preset": "focus-ring",
        "parameters": { "width": 3, "offset": 3 }
      }
    ]
  }
}
```

`document-ready` e sempre incluido pelo validador. `route-change` identifica
um plano que tambem serve para SPAs. A folha CSS fica instalada na aba e passa
a corresponder automaticamente aos elementos criados pela nova rota, sem
polling, observador de DOM ou nova chamada para a IA.

## Catalogo permitido

Os valores aceitos para `target` sao:

- `main-content`
- `interactive-elements`
- `links`
- `controls`
- `document`

Os valores aceitos para `preset` sao:

- `readable-text`: `scale` de `0.9` a `1.35`
- `reading-spacing`: `lineHeight` de `1.35` a `2` e `letterSpacing` de `0` a `2`
- `focus-ring`: `width` de `2` a `4` e `offset` de `1` a `5`
- `link-clarity`
- `control-boundaries`: `width` de `1` a `3`
- `contrast-support`
- `reduced-motion`
- `large-controls`: `minimumSize` de `36` a `48`
- `content-width`: `maxWidth` de `42` a `90`

Ha no maximo oito passos. Um passo diferente de `apply-style`, um alvo ou
preset desconhecido, ou qualquer parametro fora do limite e removido ou
normalizado antes de chegar ao compilador.

## Compilacao local

O handler `src/handlers/ai-adaptation-handler.js` converte cada passo em CSS
fixo, dentro de `@layer easyweb-ai-base` ou `@layer easyweb-ai-personal`.
Somente a extensao conhece os seletores reais usados para cada alvo. Nenhuma
instrucao da IA e executada como codigo da pagina.

O plano base e aplicado primeiro. O plano pessoal, que permanece apenas no
armazenamento local da instalacao, e aplicado depois na camada pessoal. Remover
essas duas folhas restaura a apresentacao do site e preserva o perfil normal
do EasyWeb.

## Entrega e cache

1. A API envia um plano base concluido aos sockets inscritos naquela origem ou
   um plano pessoal somente ao socket que pediu o ajuste.
2. O service worker encaminha o plano base para as abas abertas da mesma
   origem. O plano pessoal vai para a aba solicitante e mantem o perfil usado
   no pedido.
3. Ao receber o plano, o content script compila e injeta a folha na propria
   aba antes de aguardar sua persistencia no `chrome.storage.local`.
4. O plano e o CSS compilado sao guardados para o proximo acesso. O cache usa
   as versoes do handler e do Site Script; uma mudanca de versao invalida o
   CSS antigo e recompila a partir do plano validado.

Planos antigos com o campo `actions` ainda sao convertidos uma unica vez para
o formato atual. Novas respostas do Gemini devem conter somente `siteScript`.

## Rejeicoes

O validador rejeita planos de outra origem, expirados, sem `planId`, com escopo
invalido ou com uma versao desconhecida. A API tambem instrui o Gemini a nunca
retornar JavaScript, CSS livre, HTML, URLs, seletores ou instrucoes de rede.
Isso impede que uma resposta do modelo altere eventos, formularios, navegacao,
conteudo oficial ou controles da pagina.
