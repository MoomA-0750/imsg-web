import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildContext } from './child-env.js';
import { sniffImage } from './attachments.js';
import { ConvertQueue, CONVERT_TIMEOUT_MS } from './convert-queue.js';
import { WebError } from './web-error.js';

export { CONVERT_TIMEOUT_MS };
export const MAX_EDGE = 2048;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** `sips` picks the decoder from the extension, so the copy is named after the sniffed type. */
const EXTENSION: Record<string, string> = { 'image/heic': 'heic', 'image/heif': 'heif', 'image/jxl': 'jxl', 'image/x-apple-preview': 'ktx' };

export type ConverterOptions = {
  /** macOS `sips`. Tests pass a stand-in script. */
  sips: string;
  /** The same fixed environment the imsg child gets; its TMPDIR is project-owned and 0700. */
  context: ChildContext;
  /** Test seam. */
  timeoutMs?: number;
};

/**
 * Converts HEIC, JPEG XL and Messages' cached previews to JPEG with the system
 * `sips`. JPEG, because on the M1 it was the fastest to produce and WebP needed
 * a second tool and step that made it the slowest. The checked bytes are copied
 * into a private directory first, so `sips` never opens a path in Messages'
 * folders or a file swapped in after the checks. `sips` exits 0 even when it
 * fails, so success is judged only by the output's own first bytes.
 */
export class ImageConverter extends ConvertQueue {
  constructor(options: ConverterOptions) {
    super({ tool: options.sips, context: options.context, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
  }

  protected async run(input: Buffer, from: string): Promise<Buffer> {
    const extension = EXTENSION[from];
    if (!extension) throw new WebError('CONVERSION_FAILED', 415);
    const dir = await mkdtemp(join(this.queue.context.env.TMPDIR!, 'image-'));
    try {
      const source = join(dir, `in.${extension}`), target = join(dir, 'out.jpg');
      await writeFile(source, input, { mode: 0o600 });
      const size = await this.exec(dir, ['-g', 'pixelWidth', '-g', 'pixelHeight', source]);
      const edges = [...size.matchAll(/pixel(?:Width|Height):\s*(\d+)/g)].map(match => Number(match[1]));
      // -Z also enlarges, so resample only an image that is larger than the bound.
      const resample = edges.length === 2 && Math.max(...edges) > MAX_EDGE ? ['-Z', String(MAX_EDGE)] : [];
      await this.exec(dir, ['-s', 'format', 'jpeg', ...resample, source, '--out', target]);
      const output = await readFile(target).catch(() => undefined);
      if (!output || output.length === 0 || output.length > MAX_OUTPUT_BYTES || sniffImage(output.subarray(0, 16)) !== 'image/jpeg') throw new WebError('CONVERSION_FAILED', 415);
      return output;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
