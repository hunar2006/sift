/**
 * Assay Office syntax themes — low-chroma, no risk/verdict hue collision.
 * Keywords stay cool slate-blue; strings olive; never red-orange-amber or teal.
 */
export const assayDark = {
  name: "assay-dark",
  type: "dark" as const,
  colors: {
    "editor.background": "#0C0F14",
    "editor.foreground": "#C9D2E0"
  },
  tokenColors: [
    { settings: { foreground: "#C9D2E0", background: "#0C0F14" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#5D6779" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#96A6CE" }
    },
    {
      scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"],
      settings: { foreground: "#ADBB92" }
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
      settings: { foreground: "#C4CBE6" }
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"],
      settings: { foreground: "#B393B0" }
    },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#C9D2E0" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#8B95A8" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#96A6CE" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#C4CBE6" } }
  ]
};

export const assayLight = {
  name: "assay-light",
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

export type AssayThemeName = "assay-dark" | "assay-light";
