import { type URLString } from "../../logic/util/util";
import { blobToDataURL } from "../../logic/util/blob";

/** Scales an image down to `maxSize` pixels in each direction, and re-encodes
 * it as JPEG until its `data:` URL is at most `maxLength` characters long. */
export async function scaleImageToDataURL(file: Blob, maxSize: number, maxLength: number): Promise<URLString> {
  let image = new Image();
  image.src = await blobToDataURL(file);
  await image.decode();
  // An SVG may have only a `viewBox` and no size of its own
  let width = image.naturalWidth || maxSize;
  let height = image.naturalHeight || maxSize;
  let scale = Math.min(1, maxSize / Math.max(width, height));
  let canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  let context = canvas.getContext("2d");
  // JPEG has no transparency, and would show it as black
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let dataURL: URLString;
  // How well an image compresses varies wildly, so check the result
  for (let quality = 0.9; quality > 0.2; quality -= 0.2) {
    dataURL = canvas.toDataURL("image/jpeg", quality);
    if (dataURL.length <= maxLength) {
      break;
    }
  }
  return dataURL;
}
