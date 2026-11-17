import { DERDecoder } from "./der";

export class PEMDecoder extends DERDecoder {
  enc = "pem";

  decodePEM(data: any, options?: Record<string, any>): any {
    const lines = data.toString().split(/[\r\n]+/g);

    const label = options.label.toUpperCase();

    const re = /^-----(BEGIN|END) ([^-]+)-----$/;
    let start = -1;
    let end = -1;
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(re);
      if (!match) {
        continue;
      }
      if (match[2] !== label) {
        continue;
      }
      if (start === -1) {
        if (match[1] !== 'BEGIN') {
          break;
        }
        start = i;
      } else {
        if (match[1] !== 'END') {
          break;
        }
        end = i;
        break;
      }
    }
    if (start === -1 || end === -1) {
      throw new Error('PEM section not found for: ' + label);
    }
    const base64 = lines.slice(start + 1, end).join('');
    // Remove excessive symbols
    return this.decodeFromBase64(base64.replace(/[^a-z0-9+/=]+/gi, ''));
  }

  decodeFromBase64(base64: string, options?: object): any {
    return this.decode(base64ToBytes(base64), options);
  }
}

export function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.fromBase64?.(base64) ?? Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

declare global {
  interface Uint8ArrayConstructor {
    fromBase64(data: string): Uint8Array<ArrayBuffer>;
  }
}
