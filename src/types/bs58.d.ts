declare module "bs58" {
  interface Bs58 {
    encode(source: Uint8Array | number[] | string): string;
    decode(source: string): Uint8Array;
  }
  const bs58: Bs58;
  export default bs58;
}
