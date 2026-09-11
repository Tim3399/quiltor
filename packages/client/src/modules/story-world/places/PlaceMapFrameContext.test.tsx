import { cleanup, render, screen } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  PlaceMapFrameProvider,
  type PlaceMapVisualClip,
  usePlaceMapVisualClip,
  usePlaceMapVisualClipPublisher,
} from "./PlaceMapFrameContext";

afterEach(cleanup);

function Publisher({ clip }: { clip: PlaceMapVisualClip }) {
  const setClip = usePlaceMapVisualClipPublisher();
  useLayoutEffect(() => {
    setClip(clip);
    return () => setClip((current) => (current?.mapId === clip.mapId ? undefined : current));
  }, [clip, setClip]);
  return null;
}

function Reading({ mapId, name }: { mapId: string; name: string }) {
  const clip = usePlaceMapVisualClip(mapId);
  return <output aria-label={name}>{clip ? `${clip.left}:${clip.top}` : "none"}</output>;
}

describe("place map frame context", () => {
  it("switches the active clip and keeps separate canvases isolated", () => {
    const first = {
      mapId: "first",
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      top: 20,
      right: 0,
      bottom: 30,
      left: 10,
    };
    const second = {
      mapId: "second",
      bounds: { x: 30, y: 40, width: 200, height: 100 },
      top: 40,
      right: 0,
      bottom: 50,
      left: 30,
    };
    const { rerender } = render(
      <>
        <PlaceMapFrameProvider>
          <Publisher clip={first} />
          <Reading mapId="first" name="first canvas" />
        </PlaceMapFrameProvider>
        <PlaceMapFrameProvider>
          <Reading mapId="first" name="second canvas" />
        </PlaceMapFrameProvider>
      </>,
    );
    expect(screen.getByLabelText("first canvas")).toHaveTextContent("10:20");
    expect(screen.getByLabelText("second canvas")).toHaveTextContent("none");

    rerender(
      <PlaceMapFrameProvider>
        <Publisher clip={second} />
        <Reading mapId="first" name="old map" />
        <Reading mapId="second" name="new map" />
      </PlaceMapFrameProvider>,
    );
    expect(screen.getByLabelText("old map")).toHaveTextContent("none");
    expect(screen.getByLabelText("new map")).toHaveTextContent("30:40");
  });

  it("removes a published clip when its map overlay unmounts", () => {
    const clip = {
      mapId: "map",
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
    const { rerender } = render(
      <PlaceMapFrameProvider>
        <Publisher key="publisher" clip={clip} />
        <Reading key="reading" mapId="map" name="map clip" />
      </PlaceMapFrameProvider>,
    );
    expect(screen.getByLabelText("map clip")).toHaveTextContent("0:0");

    rerender(
      <PlaceMapFrameProvider>
        <Reading key="reading" mapId="map" name="map clip" />
      </PlaceMapFrameProvider>,
    );
    expect(screen.getByLabelText("map clip")).toHaveTextContent("none");
  });
});
