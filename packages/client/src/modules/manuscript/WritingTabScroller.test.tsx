import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Tab, TabList, Tabs } from "../../design";
import { WritingTabScroller } from "./WritingTabScroller";

const originalScrollIntoView = Element.prototype.scrollIntoView;
const revealedTabs: Element[] = [];
const scrollIntoView = vi.fn(function (this: Element) {
  revealedTabs.push(this);
});

function ScrollingTabs({ value }: { value: string }) {
  return (
    <Tabs value={value} onValueChange={vi.fn()}>
      <WritingTabScroller selectedValue={value}>
        <TabList label="Tools">
          <Tab value="dictionary">Dictionary</Tab>
          <Tab value="synonyms">Synonyms</Tab>
          <Tab value="translate">Translate</Tab>
        </TabList>
      </WritingTabScroller>
    </Tabs>
  );
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  revealedTabs.length = 0;
  scrollIntoView.mockClear();
});

afterAll(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: originalScrollIntoView,
    });
  } else {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
});

describe("WritingTabScroller", () => {
  it("reveals the selected tab initially and after a controlled value change", async () => {
    const view = render(<ScrollingTabs value="dictionary" />);
    const dictionary = screen.getByRole("tab", { name: "Dictionary" });

    await waitFor(() => expect(revealedTabs).toContain(dictionary));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });

    revealedTabs.length = 0;
    scrollIntoView.mockClear();
    view.rerender(<ScrollingTabs value="translate" />);
    const translate = screen.getByRole("tab", { name: "Translate" });

    await waitFor(() => expect(revealedTabs).toContain(translate));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
  });

  it("reveals a keyboard-focused tab and exposes a discoverable thin scrollbar", () => {
    render(<ScrollingTabs value="dictionary" />);
    revealedTabs.length = 0;
    scrollIntoView.mockClear();
    const synonyms = screen.getByRole("tab", { name: "Synonyms" });

    fireEvent.focus(synonyms);

    expect(revealedTabs).toContain(synonyms);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
    expect(screen.getByRole("tablist", { name: "Tools" }).parentElement).toHaveAttribute(
      "data-scrollbar",
      "thin",
    );
  });
});
