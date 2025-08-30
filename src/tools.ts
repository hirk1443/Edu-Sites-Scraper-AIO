import { fileURLToPath } from "url";
import { join } from "path";

const toolsDir = fileURLToPath(new URL("../tools", import.meta.url));

export const aria2c = join(toolsDir, "aria2c.exe");
export const yt_dlp = join(toolsDir, "yt-dlp.exe");
export const ffmpeg = join(toolsDir, "ffmpeg.exe")