import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../Dialog";
import { Popover } from "./Popover";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Popover", () => {
  it("closes from outside input and restores its trigger", async () => {
    const close = vi.fn();
    function Example() {
      const trigger = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button ref={trigger} type="button">
            Auslöser
          </button>
          <Popover
            anchorRef={trigger}
            open={open}
            label="Werkzeuge"
            onClose={() => {
              close();
              setOpen(false);
            }}
          >
            Inhalt
          </Popover>
          <button type="button">Außen</button>
        </>
      );
    }
    render(<Example />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Außen" }));
    expect(close).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole("button", { name: "Auslöser" })).toHaveFocus());
  });

  it("clamps an open desktop popover to the viewport", async () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      x: 980,
      y: 700,
      left: 980,
      top: 700,
      right: 1020,
      bottom: 730,
      width: 40,
      height: 30,
      toJSON: () => ({}),
    });
    const box = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    box.mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: 160,
      width: 240,
      height: 160,
      toJSON: () => ({}),
    });
    render(
      <Popover anchorRef={{ current: anchor }} open label="Werkzeuge" onClose={() => undefined}>
        Inhalt
      </Popover>,
    );
    const popover = screen.getByRole("dialog", { name: "Werkzeuge" });
    await waitFor(() => expect(Number.parseFloat(popover.style.left)).toBeGreaterThanOrEqual(12));
    anchor.remove();
  });

  it("does not render while closed", () => {
    render(
      <Popover anchorRef={createRef()} open={false} label="Werkzeuge" onClose={() => undefined}>
        Inhalt
      </Popover>,
    );
    expect(screen.queryByRole("dialog", { name: "Werkzeuge" })).toBeNull();
  });

  it("forwards a consumer class to its rendered surface", () => {
    render(
      <Popover
        anchorRef={createRef()}
        open
        label="Werkzeuge"
        className="consumer-popover"
        onClose={() => undefined}
      >
        Inhalt
      </Popover>,
    );

    expect(screen.getByRole("dialog", { name: "Werkzeuge" })).toHaveClass("consumer-popover");
  });

  it("can expose a semantically neutral desktop surface for composite widgets", () => {
    const anchor = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchor} type="button">
          Auslöser
        </button>
        <Popover
          anchorRef={anchor}
          open
          label="Werkzeuge"
          desktopRole="presentation"
          onClose={() => undefined}
        >
          <div role="menu" aria-label="Werkzeuge" />
        </Popover>
      </>,
    );

    expect(screen.getByRole("menu", { name: "Werkzeuge" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Werkzeuge" })).toBeNull();
  });

  it("can portal into the semantic owner of an enclosing modal", () => {
    const anchor = createRef<HTMLButtonElement>();
    const owner = createRef<HTMLDivElement>();
    render(
      <div ref={owner} role="dialog" aria-label="Außen" aria-modal="true">
        <button ref={anchor} type="button">
          Auslöser
        </button>
        <Popover
          anchorRef={anchor}
          portalContainerRef={owner}
          open
          label="Werkzeuge"
          onClose={() => undefined}
        >
          Inhalt
        </Popover>
      </div>,
    );

    expect(screen.getByRole("dialog", { name: "Außen" })).toContainElement(
      screen.getByRole("dialog", { name: "Werkzeuge" }),
    );
  });

  it("allows scrolling inside a tall popover without closing it", () => {
    const close = vi.fn();
    const anchor = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchor} type="button">
          Auslöser
        </button>
        <Popover anchorRef={anchor} open label="Werkzeuge" onClose={close}>
          <div>Inhalt</div>
        </Popover>
      </>,
    );

    fireEvent.scroll(screen.getByRole("dialog", { name: "Werkzeuge" }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.scroll(window);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes itself rather than an owning modal when Escape originates inside", async () => {
    const closePopover = vi.fn();
    const closeDialog = vi.fn();
    function Example() {
      const trigger = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(true);
      return (
        <Dialog title="Außen" closeLabel="Dialog schließen" onClose={closeDialog}>
          <button ref={trigger} type="button">
            Auslöser
          </button>
          <Popover
            anchorRef={trigger}
            open={open}
            label="Werkzeuge"
            onClose={() => {
              closePopover();
              setOpen(false);
            }}
          >
            <button type="button">Innen</button>
          </Popover>
        </Dialog>
      );
    }

    render(<Example />);
    const inner = screen.getByRole("button", { name: "Innen" });
    inner.focus();
    fireEvent.keyDown(inner, { key: "Escape" });

    expect(closePopover).toHaveBeenCalledOnce();
    expect(closeDialog).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Werkzeuge" })).toBeNull());
  });

  it("respects a child that consumes Escape without leaking it to an owning modal", () => {
    const closePopover = vi.fn();
    const closeDialog = vi.fn();
    const trigger = createRef<HTMLButtonElement>();
    render(
      <Dialog title="Außen" closeLabel="Dialog schließen" onClose={closeDialog}>
        <button ref={trigger} type="button">
          Auslöser
        </button>
        <Popover anchorRef={trigger} open label="Werkzeuge" onClose={closePopover}>
          <input aria-label="Eingabe" onKeyDown={(event) => event.preventDefault()} />
        </Popover>
      </Dialog>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Eingabe" }), { key: "Escape" });
    expect(closePopover).not.toHaveBeenCalled();
    expect(closeDialog).not.toHaveBeenCalled();
  });
});
