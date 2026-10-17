import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ReferenceView } from "../src/lib/character.js";
import { readPngDims, spriteFile } from "./files.js";
import { parseReferenceImage } from "./reference-image.js";

async function toPng(bytes: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-xerror", "-max_pixels", "16777216",
      "-i", "pipe:0", "-frames:v", "1", "-pix_fmt", "rgba", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
    { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(new Error("Reference view processing timed out")); }, 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 68_000_000) { child.kill(); reject(new Error("Reference view is too large")); }
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on("error", () => { /* Report via close/error. */ });
    child.on("error", () => { clearTimeout(timer); reject(new Error("Could not process reference view")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("Could not convert reference view to PNG"));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(bytes);
  });
}

export async function stageCharacterReferenceView(view: ReferenceView, image: unknown) {
  const { bytes, type } = await parseReferenceImage(image);
  const png = type === "image/png" ? bytes : await toPng(bytes);
  const dimensions = readPngDims(png);
  if (!dimensions) throw new Error("Could not read reference view dimensions");
  const revision = `references/${randomUUID()}`;
  const directory = spriteFile(revision);
  const extension = type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, `${view}-original.${extension}`), bytes);
    await writeFile(path.join(directory, `${view}.png`), png);
  } catch (err) {
    await rm(directory, { recursive: true, force: true });
    throw err;
  }
  return { directory, file: `${revision}/${view}.png`, dimensions };
}
