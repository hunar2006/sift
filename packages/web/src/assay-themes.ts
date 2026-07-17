/** Assay, Realized syntax themes. */
export const graphite = {
  name: "graphite",
  type: "dark" as const,
  colors: {
    "editor.background": "#101215",
    "editor.foreground": "#D4D4D4"
  },
  tokenColors: [
    { settings: { foreground: "#D4D4D4", background: "#101215" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#6A9955" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#569CD6" }
    },
    {
      scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"],
      settings: { foreground: "#CE9178" }
    },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#DCDCAA" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#4EC9B0" } },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"],
      settings: { foreground: "#B5CEA8" }
    },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#D4D4D4" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#D4D4D4" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#4EC9B0" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#9CDCFE" } }
  ]
};

export const assay = {
  name: "assay",
  type: "dark" as const,
  colors: {
    "editor.background": "#0A0E16",
    "editor.foreground": "#CBD5E6"
  },
  tokenColors: [
    { settings: { foreground: "#CBD5E6", background: "#0A0E16" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#5A6A85" } },
    { scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"], settings: { foreground: "#7AA6E8" } },
    { scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"], settings: { foreground: "#C8B07A" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#B8C7E8" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#5CC9C0" } },
    { scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"], settings: { foreground: "#C79ACF" } },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#CBD5E6" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#CBD5E6" } }
  ]
};

export const paper = {
  name: "paper",
  type: "light" as const,
  colors: {
    "editor.background": "#F7F8FA",
    "editor.foreground": "#1B2330"
  },
  tokenColors: [
    { settings: { foreground: "#1B2330", background: "#F7F8FA" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#6A737D" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#D73A49" }
    },
    {
      scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"],
      settings: { foreground: "#032F62" }
    },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#6F42C1" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#005CC5" } },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"],
      settings: { foreground: "#005CC5" }
    },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#1B2330" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#586069" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#22863A" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#005CC5" } }
  ]
};

export type SightlineThemeName = "graphite" | "assay" | "paper";
