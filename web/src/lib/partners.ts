export type Partner = { id: string; name: string; subtitle: string | null; url: string | null; logo: string; sort_order: number; visible: boolean };

/** A logo is a file of the website (partners/x.png), an https URL or an uploaded data URL. */
export const logoSrc = (logo: string) => (/^(data:|https:)/.test(logo) ? logo : `${import.meta.env.BASE_URL}${logo}`);

/** Reads an image file and returns it resized (longest side at most `max` px) as a data URL. */
export async function imageToDataUrl(file: File, max = 400): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file (PNG, JPG, SVG or WebP).");
  if (file.size > 15 * 1024 * 1024) throw new Error("The image is too large (max 15 MB).");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("This image cannot be read.")); i.src = url; });
    const w0 = img.naturalWidth || 400, h0 = img.naturalHeight || 400;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL("image/png");
    if (out.length > 550_000) out = c.toDataURL("image/webp", 0.86);
    if (out.length > 550_000) throw new Error("The image is still too heavy after resizing: use a simpler logo.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
