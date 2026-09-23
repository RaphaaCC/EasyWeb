const MAX_SCORE = 1;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function createRecommendations(summary = {}) {
  const actions = [];
  const warnings = [];
  let confidence = 0.5;

  if (summary.hasExternalAccessibilityTool) {
    warnings.push("Uma ferramenta de acessibilidade do site foi detectada; prefira o modo de compatibilidade.");
  }

  if (isFiniteNumber(summary.minimumContrast) && summary.minimumContrast < 4.5) {
    actions.push({
      type: "contrast",
      scope: "page",
      value: true,
      reason: "Foi detectado contraste abaixo da referência WCAG AA para texto comum."
    });
    confidence += 0.15;
  }

  if (isFiniteNumber(summary.averageFontSize) && summary.averageFontSize < 16) {
    actions.push({
      type: "fontScale",
      scope: summary.hasMainContent ? "main-content" : "page",
      value: 1.15,
      reason: "O texto principal parece menor que 16px em média."
    });
    confidence += 0.1;
  }

  if (summary.linksRelyOnColor) {
    actions.push({
      type: "highlightLinks",
      scope: "page",
      value: true,
      reason: "Alguns links dependem principalmente de cor para serem identificados."
    });
    confidence += 0.1;
  }

  if (summary.hasMotion) {
    actions.push({
      type: "reduceMotion",
      scope: "page",
      value: true,
      reason: "A página possui animações ou transições perceptíveis."
    });
    confidence += 0.05;
  }

  if (summary.pageType === "article" && summary.hasMainContent) {
    actions.push({
      type: "readingFocus",
      scope: "main-content",
      value: true,
      reason: "A estrutura da página indica conteúdo de leitura contínua."
    });
    confidence += 0.1;
  }

  if (summary.isDynamic) {
    warnings.push("Página dinâmica detectada; o Carregamento Rápido não deve ser recomendado.");
  }

  return {
    confidence: clamp(confidence, 0, MAX_SCORE),
    actions,
    warnings
  };
}
