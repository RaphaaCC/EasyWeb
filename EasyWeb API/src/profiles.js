export const profiles = Object.freeze([
  {
    id: "default",
    label: "Padrão",
    description: "Ajustes manuais e individuais por site.",
    settings: {
      enabled: false,
      fontScale: 1,
      lineHeight: 1.4,
      letterSpacing: 0,
      contrast: false,
      highlightLinks: false,
      reduceMotion: false,
      readingFocus: false,
      colorFilter: "none",
      fastMode: false
    }
  },
  {
    id: "elderly",
    label: "Idoso",
    description: "Texto maior, espaçamento ampliado, contraste e links destacados.",
    settings: {
      enabled: true,
      fontScale: 1.25,
      lineHeight: 1.7,
      letterSpacing: 0.5,
      contrast: true,
      highlightLinks: true,
      reduceMotion: false,
      readingFocus: false,
      colorFilter: "none",
      fastMode: false
    }
  },
  {
    id: "children",
    label: "Crianças",
    description: "Leitura mais clara e elementos interativos fáceis de identificar.",
    settings: {
      enabled: true,
      fontScale: 1.15,
      lineHeight: 1.6,
      letterSpacing: 0.3,
      contrast: true,
      highlightLinks: true,
      reduceMotion: false,
      readingFocus: false,
      colorFilter: "none",
      fastMode: false
    }
  },
  {
    id: "pcd",
    label: "PCD",
    description: "Contraste, espaçamento e navegação visual reforçados.",
    settings: {
      enabled: true,
      fontScale: 1.15,
      lineHeight: 1.7,
      letterSpacing: 0.5,
      contrast: true,
      highlightLinks: true,
      reduceMotion: false,
      readingFocus: false,
      colorFilter: "none",
      fastMode: false
    }
  },
  {
    id: "colorblind",
    label: "Daltônico",
    description: "Leitura reforçada com filtro de cores configurável.",
    settings: {
      enabled: true,
      fontScale: 1.1,
      lineHeight: 1.6,
      letterSpacing: 0.3,
      contrast: false,
      highlightLinks: true,
      reduceMotion: false,
      readingFocus: false,
      colorFilter: "deuteranopia",
      fastMode: false
    }
  },
  {
    id: "dyslexia",
    label: "Dislexia",
    description: "Mais espaço entre letras e linhas para reduzir a aglomeração visual.",
    settings: {
      enabled: true,
      fontScale: 1.2,
      lineHeight: 1.9,
      letterSpacing: 0.8,
      contrast: false,
      highlightLinks: true,
      reduceMotion: false,
      readingFocus: false,
      colorFilter: "none",
      fastMode: false
    }
  },
  {
    id: "lowVision",
    label: "Baixa visão",
    description: "Texto ampliado, contraste forte e elementos interativos destacados.",
    settings: {
      enabled: true,
      fontScale: 1.4,
      lineHeight: 1.9,
      letterSpacing: 0.8,
      contrast: true,
      highlightLinks: true,
      reduceMotion: false,
      readingFocus: false,
      colorFilter: "none",
      fastMode: false
    }
  },
  {
    id: "sensory",
    label: "Sensibilidade visual",
    description: "Reduz movimentos e transições para uma navegação mais estável.",
    settings: {
      enabled: true,
      fontScale: 1.1,
      lineHeight: 1.6,
      letterSpacing: 0.3,
      contrast: false,
      highlightLinks: true,
      reduceMotion: true,
      readingFocus: false,
      colorFilter: "none",
      fastMode: false
    }
  },
  {
    id: "reading",
    label: "Leitura focada",
    description: "Organiza regiões semânticas de conteúdo para leitura prolongada.",
    settings: {
      enabled: true,
      fontScale: 1.2,
      lineHeight: 1.8,
      letterSpacing: 0.5,
      contrast: false,
      highlightLinks: false,
      reduceMotion: true,
      readingFocus: true,
      colorFilter: "none",
      fastMode: false
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
