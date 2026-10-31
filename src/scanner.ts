import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

export function createReader(): BrowserMultiFormatReader {
  const formats = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E];
  return new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS, formats]]));
}

// Calls onCode for each code seen, and returns a function that stops the camera.
export async function startScanner(video: HTMLVideoElement, onCode: (code: string) => void): Promise<() => void> {
  const controls = await createReader().decodeFromConstraints(
    { video: { facingMode: "environment" } },
    video,
    (result) => {
      if (result) onCode(result.getText());
    },
  );
  return () => controls.stop();
}
