/**
 * Getting a picture off disk and into the world, at a size worth keeping.
 *
 * A generated map arrives at whatever the generator felt like producing, often
 * far past what any screen shows. Shrinking it here is not thrift for its own
 * sake: the upload has to clear a request ceiling, and the picture then lives
 * inside the world database that every backup copies whole.
 */

/** Beyond this the extra pixels are invisible on any canvas the app draws. */
export const MAX_STORED_EDGE = 4096;

/** WebP at this quality is indistinguishable from the source for a map. */
const RECODE_QUALITY = 0.9;

export const ACCEPTED_MAP_TYPES = "image/png,image/jpeg,image/webp";

export async function prepareMapImage(file: Blob): Promise<Blob> {
  // Environments without these -- a test renderer, an old browser -- keep the
  // original rather than failing: the server decides what it will accept.
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_STORED_EDGE) return file;
    const ratio = MAX_STORED_EDGE / longest;
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type: "image/webp", quality: RECODE_QUALITY });
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}

/**
 * Ask for one image file.
 *
 * The input is created for the click and thrown away, rather than sitting
 * hidden in the toolbar's markup: a control in JSX is design-system debt the
 * ratchet refuses, and a picker is a gesture rather than part of the interface.
 * It is the browser's own dialog, so no host capability is involved and the
 * desktop shell behaves exactly like the web.
 */
export function askForMapImage(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ACCEPTED_MAP_TYPES;
    // Out of the way but in the document: a detached input can be clicked
    // without a browser opening anything, which looks exactly like a button
    // that does nothing. `display: none` is not safe here for the same reason,
    // so it is moved off-screen instead.
    picker.style.position = "fixed";
    picker.style.left = "-9999px";
    picker.style.opacity = "0";
    document.body.append(picker);

    const settle = (file: Blob | null) => {
      picker.remove();
      resolve(file);
    };
    picker.addEventListener("change", () => settle(picker.files?.[0] ?? null), { once: true });
    // A dialog dismissed without choosing fires `cancel` where it is supported;
    // where it is not, the element is collected with the page rather than
    // leaving the promise pending forever on a path nothing awaits.
    picker.addEventListener("cancel", () => settle(null), { once: true });
    picker.click();
  });
}
