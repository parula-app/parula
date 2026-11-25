/** How long a KeyPackage's leaf node stays valid, RFC 9420 § 7.2.
 *
 *     struct {
 *         uint64 not_before;
 *         uint64 not_after;
 *     } Lifetime;
 *
 * Both are absolute seconds since the Unix epoch. */
import { TLSReader } from "../Codec/TLSReader";
import { TLSWriter } from "../Codec/TLSWriter";

export class Lifetime {
  readonly notBefore: bigint;
  readonly notAfter: bigint;

  constructor(notBefore: bigint, notAfter: bigint) {
    this.notBefore = notBefore;
    this.notAfter = notAfter;
  }

  /** Starts an hour ago, to tolerate a clock that runs slightly behind ours. */
  static forDays(days: number, now = new Date()): Lifetime {
    let nowSeconds = BigInt(Math.floor(now.getTime() / 1000));
    return new Lifetime(nowSeconds - 3600n, nowSeconds + BigInt(Math.round(days * 24 * 3600)));
  }

  static read(reader: TLSReader): Lifetime {
    return new Lifetime(reader.uint64(), reader.uint64());
  }

  writeTo(writer: TLSWriter): void {
    writer.uint64(this.notBefore).uint64(this.notAfter);
  }

  contains(when: Date): boolean {
    let seconds = BigInt(Math.floor(when.getTime() / 1000));
    return this.notBefore <= seconds && seconds <= this.notAfter;
  }
}
