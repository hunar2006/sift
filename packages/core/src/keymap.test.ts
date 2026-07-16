import { describe, expect, it } from "vitest";
import { KEYMAP, formatKeymapLine, keymapEntries, shortcutForPaletteAction } from "./keymap.js";

describe("keymap", () => {
  it("has unique entry and palette action identifiers", () => {
    expect(new Set(KEYMAP.map((entry) => entry.id)).size).toBe(KEYMAP.length);
    const paletteActions = KEYMAP.flatMap((entry) => entry.paletteAction ? [entry.paletteAction] : []);
    expect(new Set(paletteActions).size).toBe(paletteActions.length);
  });

  it("keeps intentional web and TUI differences scoped", () => {
    expect(keymapEntries("web").some((entry) => entry.id === "tui-editor")).toBe(false);
    expect(keymapEntries("tui").some((entry) => entry.id === "web-split")).toBe(false);
    expect(keymapEntries("web").some((entry) => entry.id === "shared-redo")).toBe(true);
    expect(keymapEntries("tui").some((entry) => entry.id === "shared-redo")).toBe(true);
  });

  it("links web palette actions to their displayed shortcuts", () => {
    expect(shortcutForPaletteAction("approve")).toBe("a");
    expect(shortcutForPaletteAction("search")).toBe("Ctrl/Cmd+F");
    expect(shortcutForPaletteAction("revert-file")).toBe("R");
  });

  it("formats compact rows from registry entries", () => {
    expect(formatKeymapLine(["shared-next-hunk", "shared-prev-hunk"])).toBe("j Next hunk | k Previous hunk");
  });
});
