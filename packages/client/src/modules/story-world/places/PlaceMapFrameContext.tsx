import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useMemo,
  useState,
} from "react";

export interface PlaceMapVisualClip {
  mapId: string;
  /** The currently painted part of the image in React Flow world coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
  top: number;
  right: number;
  bottom: number;
  left: number;
}

type PlaceMapFrameContextValue = {
  clip: PlaceMapVisualClip | undefined;
  setClip: Dispatch<SetStateAction<PlaceMapVisualClip | undefined>>;
};

const PlaceMapFrameContext = createContext<PlaceMapFrameContextValue | undefined>(undefined);

/** Keeps projected map chrome geometry local to one canvas instance. */
export function PlaceMapFrameProvider({ children }: { children: ReactNode }) {
  const [clip, setClip] = useState<PlaceMapVisualClip>();
  const value = useMemo(() => ({ clip, setClip }), [clip]);
  return <PlaceMapFrameContext.Provider value={value}>{children}</PlaceMapFrameContext.Provider>;
}

export function usePlaceMapVisualClip(mapId: string | undefined): PlaceMapVisualClip | undefined {
  const clip = useContext(PlaceMapFrameContext)?.clip;
  return mapId !== undefined && clip?.mapId === mapId ? clip : undefined;
}

export function usePlaceMapVisualClipPublisher() {
  const frame = useContext(PlaceMapFrameContext);
  if (!frame) throw new Error("Map visual clipping requires a PlaceMapFrameProvider");
  return frame.setClip;
}
