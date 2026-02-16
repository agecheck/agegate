declare module 'pako' {
  export type UngzipOptions = {
    to?: 'string' | 'uint8array';
  };

  export function ungzip(data: Uint8Array, options?: UngzipOptions): string | Uint8Array;
  export function gzip(data: string | Uint8Array): Uint8Array;
}

