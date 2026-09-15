import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildContext } from './child-env.js';
import { sniffAudio } from './attachments.js';
import { ConvertQueue } from './convert-queue.js';
import { WebError } from './web-error.js';

/** What everything here is converted to: AAC in an MPEG-4 container, which every browser and phone plays. */
export const AUDIO_OUT_TYPE = 'audio/mp4';
/** Voice, not music. Mono at this rate stays clear and keeps a minute's talking near a quarter of a megabyte. */
export const AUDIO_BITRATE = 48_000;
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;

export type AudioConverterOptions = {
  /** macOS `afconvert`. Tests pass a stand-in script. */
  afconvert: string;
  /** The same fixed environment the imsg child gets; its TMPDIR is project-owned and 0700. */
  context: ChildContext;
  /** Test seam. */
  timeoutMs?: number;
};

/**
 * Converts audio to AAC with the system `afconvert`. It serves both directions:
 * a voice message from Messages, which is a CAF no browser outside Safari
 * plays, and a recording from the browser, which can only be made as raw PCM
 * and should not cross a phone line at that size.
 *
 * As with images, the bytes are copied into a private directory first, so the
 * tool never opens a path in Messages' folders or a file swapped in after the
 * checks. `afconvert` reads the format from the bytes rather than the name, so
 * the copy needs no extension, and it reports failure honestly — but success is
 * still judged by the output's own first bytes.
 */
export class AudioConverter extends ConvertQueue {
  constructor(options: AudioConverterOptions) {
    super({ tool: options.afconvert, context: options.context, ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }) });
  }

  protected async run(input: Buffer): Promise<Buffer> {
    const dir = await mkdtemp(join(this.queue.context.env.TMPDIR!, 'audio-'));
    try {
      const source = join(dir, 'in'), target = join(dir, 'out.m4a');
      await writeFile(source, input, { mode: 0o600 });
      await this.exec(dir, ['-f', 'm4af', '-d', 'aac', '-b', String(AUDIO_BITRATE), source, target]);
      const output = await readFile(target).catch(() => undefined);
      if (!output || output.length === 0 || output.length > MAX_OUTPUT_BYTES || sniffAudio(output.subarray(0, 16)) !== AUDIO_OUT_TYPE) throw new WebError('CONVERSION_FAILED', 415);
      return output;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
