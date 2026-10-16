declare module 'mammoth' {
  export interface Result {
    value: string;
    messages: Array<{
      type: string;
      message: string;
    }>;
  }

  export interface Options {
    buffer: Buffer;
  }

  export function extractRawText(options: { buffer: Buffer }): Promise<Result>;
}
