import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("apps/web/public", { recursive: true });
for (const size of [16, 32]) {
  await sharp("apps/web/favicon.svg").resize(size, size).png().toFile(`apps/web/public/favicon-${size}.png`);
}
const png = await sharp("apps/web/favicon.svg").resize(32, 32).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 32; ico[7] = 32;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18);
await writeFile("apps/web/public/favicon.ico", Buffer.concat([ico, png]));
