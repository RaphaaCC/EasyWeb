export const profiles = Object.freeze([
  {
    "id": "default",
    "label": "Padrão",
    "description": "Mantém a aparência original. Permite ajustes manuais por site e filtro de cores global.",
    "settings": {
      "enabled": false,
      "fontScale": 1,
      "lineHeight": 1.4,
      "letterSpacing": 0,
      "contrast": false,
      "highlightLinks": false,
      "reduceMotion": false,
      "readingFocus": false,
      "colorFilter": "none",
      "fastMode": false
    }
  },
  {
    "id": "elderly",
    "label": "Idoso",
    "description": "Mais conforto para leitura, separação visual e navegação.",
    "settings": {
      "enabled": true,
      "fontScale": 1.25,
      "lineHeight": 1.7,
      "letterSpacing": 0.5,
      "contrast": true,
      "highlightLinks": true,
      "reduceMotion": false,
      "readingFocus": false,
      "colorFilter": "none",
      "fastMode": false
    }
  },
  {
    "id": "children",
    "label": "Crianças",
    "description": "Leitura mais clara e elementos interativos fáceis de identificar.",
    "settings": {
      "enabled": true,
      "fontScale": 1.15,
      "lineHeight": 1.6,
      "letterSpacing": 0.3,
      "contrast": false,
      "highlightLinks": true,
      "reduceMotion": false,
      "readingFocus": false,
      "colorFilter": "none",
      "fastMode": false
    }
  },
  {
    "id": "dyslexia",
    "label": "Dislexia",
    "description": "Fonte OpenDyslexic, texto ampliado e mais espaço entre letras e linhas.",
    "settings": {
      "enabled": true,
      "fontScale": 1.2,
      "lineHeight": 1.9,
      "dyslexiaFont": true,
      "letterSpacing": 0.8,
      "contrast": false,
      "highlightLinks": true,
      "reduceMotion": false,
      "readingFocus": false,
      "colorFilter": "none",
      "fastMode": false
    }
  },
  {
    "id": "lowVision",
    "label": "Baixa visão",
    "description": "Texto ampliado, contraste forte e elementos interativos destacados.",
    "settings": {
      "enabled": true,
      "fontScale": 1.4,
      "lineHeight": 1.9,
      "letterSpacing": 0.8,
      "contrast": true,
      "highlightLinks": true,
      "reduceMotion": false,
      "readingFocus": false,
      "colorFilter": "none",
      "fastMode": false
    }
  },
  {
    "id": "sensory",
    "label": "Sensibilidade visual",
    "description": "Reduz movimentos e transições para uma navegação mais estável.",
    "settings": {
      "enabled": true,
      "fontScale": 1.1,
      "lineHeight": 1.6,
      "letterSpacing": 0.3,
      "contrast": false,
      "highlightLinks": true,
      "reduceMotion": true,
      "readingFocus": false,
      "colorFilter": "none",
      "fastMode": false
    }
  },
  {
    "id": "reading",
    "label": "Leitura focada",
    "description": "Guia de leitura que acompanha o mouse ou o foco do teclado e escurece suavemente o restante da página.",
    "settings": {
      "enabled": true,
      "fontScale": 1.2,
      "lineHeight": 1.8,
      "letterSpacing": 0.5,
      "contrast": false,
      "highlightLinks": false,
      "reduceMotion": true,
      "readingFocus": true,
      "colorFilter": "none",
      "fastMode": false
    }
  }
]);

export const colorFilters = Object.freeze([
  "protanopia",
  "protanomaly",
  "deuteranopia",
  "deuteranomaly",
  "tritanopia",
  "tritanomaly",
  "achromatopsia",
  "achromatomaly",
  "blue-cone-monochromacy"
]);
