import test from "node:test";
import assert from "node:assert/strict";
import { createRecommendations } from "../src/recommendations.js";

test("recomenda apenas ações suportadas para uma página de artigo", () => {
  const result = createRecommendations({
    pageType: "article",
    hasMainContent: true,
    minimumContrast: 3.2,
    averageFontSize: 14,
    linksRelyOnColor: true,
    hasMotion: true,
    isDynamic: false
  });

  assert.deepEqual(
    result.actions.map((action) => action.type),
    ["contrast", "fontScale", "highlightLinks", "reduceMotion", "readingFocus"]
  );
  assert.ok(result.confidence > 0.9);
});

test("alerta quando a página é dinâmica ou já possui ferramenta externa", () => {
  const result = createRecommendations({
    hasExternalAccessibilityTool: true,
    isDynamic: true
  });

  assert.equal(result.actions.length, 0);
  assert.equal(result.warnings.length, 2);
});
