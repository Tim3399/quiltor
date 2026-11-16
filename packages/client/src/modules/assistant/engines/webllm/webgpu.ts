// Whether this browser can run the in-browser engine (T-61 part 7), checked the way the T-54
// measurement page does (tools/evaluation/browser-inference/index.html).

type AdapterInfo = {
  vendor?: string;
  architecture?: string;
  description?: string;
  isFallbackAdapter?: boolean;
};

type GpuAdapter = {
  info?: AdapterInfo;
  isFallbackAdapter?: boolean;
  requestAdapterInfo?: () => Promise<AdapterInfo>;
};

export type GpuLike = {
  requestAdapter(options?: { powerPreference?: "high-performance" }): Promise<GpuAdapter | null>;
};

// A software adapter runs WebGPU on the CPU, where a 4B model never finishes: it counts as none.
const SOFTWARE = /swiftshader|llvmpipe|lavapipe|warp|basic render|software|\bcpu\b/i;

/** True only for a hardware adapter; no WebGPU, no adapter or a software one is false. */
export async function probeWebGpu(gpu: GpuLike | undefined): Promise<boolean> {
  if (!gpu) return false;
  try {
    // The preference WebLLM itself uses, so the check sees the adapter that will compute.
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return false;
    const info = adapter.info ?? (await adapter.requestAdapterInfo?.()) ?? {};
    if (info.isFallbackAdapter === true || adapter.isFallbackAdapter === true) return false;
    const named = [info.vendor, info.architecture, info.description].filter(Boolean).join(" ");
    return !SOFTWARE.test(named);
  } catch {
    return false;
  }
}

let probe: Promise<boolean> | null = null;

/** The probe for this page's navigator.gpu, run once. */
export function browserWebGpu(): Promise<boolean> {
  probe ??= probeWebGpu(
    typeof navigator === "undefined" ? undefined : (navigator as { gpu?: GpuLike }).gpu,
  );
  return probe;
}
