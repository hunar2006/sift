/** Hallmark syntax themes — one voice per room. */
export const graphite = {
  name: "graphite",
  type: "dark" as const,
  colors: {
    "editor.background": "#0D0F12",
    "editor.foreground": "#CBD5DF"
  },
  tokenColors: [
    { settings: { foreground: "#CBD5DF", background: "#0D0F12" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#5F6B7A" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#82A8E8" }
    },
    {
      scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"],
      settings: { foreground: "#D8AE7E" }
    },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#DCD9A0" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#6FC3B8" } },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"],
      settings: { foreground: "#C7A6DC" }
    },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#CBD5DF" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#8B96A3" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#6FC3B8" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#9CC3F0" } }
  ]
};

export const assay = {
  name: "assay",
  type: "dark" as const,
  colors: {
    "editor.background": "#070C15",
    "editor.foreground": "#C6D4E8"
  },
  tokenColors: [
    { settings: { foreground: "#C6D4E8", background: "#070C15" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#54678A" } },
    { scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"], settings: { foreground: "#7EA0F0" } },
    { scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"], settings: { foreground: "#D8B36A" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#BCCDF0" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#58D0C2" } },
    { scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"], settings: { foreground: "#C99AD8" } },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#C6D4E8" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#7E93B8" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#58D0C2" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#A8C2F0" } }
  ]
};

export const paper = {
  name: "paper",
  type: "light" as const,
  colors: {
    "editor.background": "#FBF9F4",
    "editor.foreground": "#232A38"
  },
  tokenColors: [
    { settings: { foreground: "#232A38", background: "#FBF9F4" } },
    { scope: ["comment", "punctuation.definition.comment", "string.comment"], settings: { foreground: "#7A7466" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new"],
      settings: { foreground: "#9A2E3F" }
    },
    {
      scope: ["string", "string.quoted", "string.template", "punctuation.definition.string"],
      settings: { foreground: "#1F4E9C" }
    },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#6B3FA8" } },
    { scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"], settings: { foreground: "#0F6E6E" } },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "variable.other.constant", "support.constant"],
      settings: { foreground: "#8A5A12" }
    },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#232A38" } },
    { scope: ["punctuation", "meta.brace"], settings: { foreground: "#4A5060" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#0F6E6E" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#1F4E9C" } }
  ]
};

export type SightlineThemeName = "graphite" | "assay" | "paper";
