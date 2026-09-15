/**
 * `?url` asks the bundler for a file's address instead of its contents. The AudioWorklet module is
 * loaded that way because the audio thread fetches it itself, by URL, at run time.
 */
declare module '*?url' {
  const url: string;
  export default url;
}
