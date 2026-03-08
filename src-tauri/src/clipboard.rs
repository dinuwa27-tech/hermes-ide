use image::GenericImageView;

/// Copy an image file to the system clipboard as image data,
/// and also set a text representation (the file path) so that
/// terminal paste events have text content to deliver through the PTY.
///
/// On macOS this uses NSPasteboard to set both types simultaneously.
/// On other platforms, falls back to arboard (image-only) + separate text set.
#[tauri::command]
pub fn copy_image_to_clipboard(path: String) -> Result<(), String> {
    let img =
        image::open(&path).map_err(|e| format!("Failed to open image '{}': {}", path, e))?;
    let rgba = img.to_rgba8();
    let (width, height) = img.dimensions();

    set_clipboard_image_and_text(&rgba, width, height, &path)
}

/// Platform-specific clipboard write that sets BOTH image and text data.
#[cfg(target_os = "macos")]
fn set_clipboard_image_and_text(
    rgba: &[u8],
    width: u32,
    height: u32,
    text: &str,
) -> Result<(), String> {
    use std::process::Command;

    // Encode the RGBA data as PNG in memory
    let png_bytes = encode_png(rgba, width, height)?;

    // Write PNG to a temp file, then use osascript to set clipboard
    let tmp = std::env::temp_dir().join("hermes_clipboard.png");
    std::fs::write(&tmp, &png_bytes)
        .map_err(|e| format!("Failed to write temp PNG: {}", e))?;

    // Use AppleScript to set both image and text on the pasteboard.
    // "set the clipboard to" sets the primary type; we add text via shell.
    let script = format!(
        r#"
        use framework "AppKit"
        set pb to current application's NSPasteboard's generalPasteboard()
        pb's clearContents()
        set img to current application's NSImage's alloc()'s initWithContentsOfFile:"{}"
        pb's setData:(img's TIFFRepresentation()) forType:(current application's NSPasteboardTypeTIFF)
        pb's setString:"{}" forType:(current application's NSPasteboardTypeString)
        "#,
        tmp.display(),
        text.replace('\\', "\\\\").replace('"', "\\\""),
    );

    let output = Command::new("osascript")
        .args(["-l", "AppleScript", "-e", &script])
        .output()
        .map_err(|e| format!("Failed to run osascript: {}", e))?;

    // Clean up temp file (best effort)
    let _ = std::fs::remove_file(&tmp);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("osascript failed: {}", stderr));
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn set_clipboard_image_and_text(
    rgba: &[u8],
    width: u32,
    height: u32,
    text: &str,
) -> Result<(), String> {
    use arboard::{Clipboard, ImageData};
    use std::borrow::Cow;

    let img_data = ImageData {
        width: width as usize,
        height: height as usize,
        bytes: Cow::from(rgba.to_vec()),
    };

    let mut clipboard =
        Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;

    // arboard clears previous data on set, so image takes priority.
    // Set image first, then try to also set text (may replace image on some platforms).
    clipboard
        .set_image(img_data)
        .map_err(|e| format!("Failed to set clipboard image: {}", e))?;

    // On Windows/Linux, setting text after image may clear the image.
    // If that happens, the file path in the terminal is still useful.
    let _ = clipboard.set_text(text);

    Ok(())
}

/// Encode raw RGBA pixel data as PNG bytes.
fn encode_png(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    use image::{ImageBuffer, Rgba};
    let img: ImageBuffer<Rgba<u8>, _> =
        ImageBuffer::from_raw(width, height, rgba.to_vec())
            .ok_or_else(|| "Failed to create image buffer".to_string())?;
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;
    Ok(buf.into_inner())
}
