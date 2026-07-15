/**
 * Assay Office syntax themes — low-chroma, no risk/verdict hue collision.
 * Keywords stay cool slate-blue; strings olive; never red-orange-amber or teal.
 */
export const graphite = {
  name: "graphite",
  type: "dark" as const,
  colors: {
    "editor.background": "#1A1D21",
    "editor.foreground": "#D4D4D4"
  },
  tokenColors: [
    { settings: { foreground: "#D4D4D4", background: "#1A1D21" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#6A9955" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#569CD6" }
    },
    {
      scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"],
      settings: { foreground: "#CE9178" }
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call",
        "entity.name.type",
        "entity.name.class",
        "support.type",
        "support.class"
      ],
      settings: { foreground: "#DCDCAA" }
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"],
      settings: { foreground: "#B5CEA8" }
    },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#D4D4D4" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#D4D4D4" } },
    { scope: ["entity.name.tag", "entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#4EC9B0" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#9CDCFE" } }
  ]
};

export const assay = {
  name: "assay",
  type: "dark" as const,
  colors: {
    "editor.background": "#0C0F14",
    "editor.foreground": "#C9D2E0"
  },
  tokenColors: [
    { settings: { foreground: "#C9D2E0", background: "#0C0F14" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#5D6779" } },
    { scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"], settings: { foreground: "#96A6CE" } },
    { scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"], settings: { foreground: "#ADBB92" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#C4CBE6" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#8BC7BE" } },
    { scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"], settings: { foreground: "#B393B0" } },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#C9D2E0" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#8B95A8" } }
  ]
};

export const paper = {
  name: "paper",
  type: "light" as const,
  colors: {
    "editor.background": "#F7F8FA",
    "editor.foreground": "#2A3344"
  },
  tokenColors: [
    { settings: { foreground: "#2A3344", background: "#F7F8FA" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#7A8496" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#5A6B94" }
    },
    {
      scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"],
      settings: { foreground: "#5F7348" }
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call",
        "entity.name.type",
        "entity.name.class",
        "support.type",
        "support.class"
      ],
      settings: { foreground: "#4A5570" }
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"],
      settings: { foreground: "#7A5F78" }
    },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#2A3344" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#5C6675" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#5A6B94" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#4A5570" } }
  ]
};

export type SightlineThemeName = "graphite" | "assay" | "paper";
