import { invoke } from "@tauri-apps/api/core";

/** Copy an image file to the system clipboard as image data. */
export function copyImageToClipboard(path: string): Promise<void> {
  return invoke("copy_image_to_clipboard", { path });
}
