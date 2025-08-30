import got from "got";
import ora from "ora";
import prompts from "prompts";
import pMap from "p-map";
import sharp from "sharp";
import { execa } from "execa";
import { mkdir } from "node:fs/promises";
import { join, parse } from "node:path";
import { ffmpeg, yt_dlp } from "../tools.js";
import { sanitizePath } from "./helper/sanitizePath.js";
import {
  LessonApiResponse,
  VideoResource,
  VideoUrl,
} from "../types/empire_type.js";
import { url } from "node:inspector";

export const website = "empire.edu.vn";

type AuthResult = {
  errorCode: number;
  accessToken: string;
  refreshToken: string;
};

export async function login(_: never, username: string, password: string) {
  const json = {
    email: username,
    password,
    device: {
      deviceId: "1391468667",
      platform: "web",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    },
  };

  try {
    const { accessToken } = await got
      .post("https://api.empire.io.vn/api/v1/auth/login", {
        json,
      })
      .json<AuthResult>();
    return accessToken;
  } catch (error: any) {
    return null;
  }
}

export async function logout() {}

export async function downloadVideo(
  token: string,
  id: string,
  output: string,
  ffmpegPath: string
) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  };
  const spinner = ora("Getting video details...").start();

  const parsed = id.split("/");
  const slug = parsed[parsed.length - 1];

  try {
    const response: LessonApiResponse = await got
      .get(`https://api.empire.io.vn/api/v1/lessons/slug/${slug}`, {
        headers,
      })
      .json<LessonApiResponse>();

    spinner.info(`Processing lesson: ${response.lesson.title}`);

    const videoResources: VideoResource[] = [];

    if (
      response?.lesson?.resources &&
      Array.isArray(response.lesson.resources)
    ) {
      spinner.text = "Filtering video resources...";
      for (const resourceWrapper of response.lesson.resources) {
        const resource = resourceWrapper.resource;
        if (resource?.type === "video") videoResources.push(resource);
      }
    } else {
      spinner.fail("Could not find 'resources' array in the lesson response.");
      return;
    }

    if (videoResources.length === 0) {
      spinner.fail("No videos found in this lesson.");
      return;
    }

    spinner.succeed(
      `Successfully filtered ${videoResources.length} video(s) from lesson "${response.lesson.title}".`
    );

    const { choices } = await prompts({
      type: "multiselect",
      name: "choices",
      message: "Select videos to download",
      choices: videoResources.map((v, i) => ({
        title: `${i + 1}. ${v.title}`,
        value: v,
      })),
      hint: "- Space to select. Enter to start download.",
    });

    if (!choices || choices.length === 0) {
      spinner.info("No videos selected. Exiting.");
      return;
    }

    const total = choices.length;
    let count = 0;

    spinner.start(`Downloading ${total} videos... (0/${total})`);

    await pMap(
      choices as VideoResource[],
      async (video: VideoResource, idx: number) => {
        const title = video.title;
        const perSpinner = ora(`Preparing "${title}"`).start();

        try {
          // Lấy presigned URL
          const videoUrl: VideoUrl = await got
            .get(
              `https://api.empire.io.vn/api/v1/files/presigned/${video.fileUrl}`,
              { headers }
            )
            .json<VideoUrl>();

          const subdir_videos = join(
            output,
            sanitizePath(response.lesson.title)
          );
          await mkdir(subdir_videos, { recursive: true });
          const sanitizedTitle = sanitizePath(title);
          const outPath = join(
            subdir_videos,
            `${idx + 1}. ${sanitizedTitle}`
          );

          const userAgent = headers["user-agent"];
          const totalSeconds = await probeDurationSeconds(
            ffmpegPath,
            videoUrl.url,
            userAgent
          );

          // Chạy ffmpeg với progress
          const args = [
            "-y",
            "-user_agent",
            userAgent,
            "-reconnect",
            "1",
            "-reconnect_streamed",
            "1",
            "-reconnect_at_eof",
            "1",
            "-reconnect_delay_max",
            "2",
            "-rw_timeout",
            "15000000",

            "-i",
            videoUrl.url,

            "-c",
            "copy",
            "-movflags",
            "+faststart",

            "-progress",
            "pipe:1",
            "-nostats",
            "-loglevel",
            "error",

            outPath,
          ];

          const child = execa(ffmpegPath, args, {
            stdout: "pipe",
            stderr: "pipe",
          });

          let lastPercent = -1;
          let lastSpeed = "";
          let lastOutTimeSec = 0;

          child.stdout?.on("data", (buf: Buffer) => {
            const text = buf.toString();

            for (const line of text.split(/\r?\n/)) {
              const [k, v] = line.split("=");
              if (!k || v === undefined) continue;
              if (k === "out_time_ms") {
                const sec = Number(v) / 1_000_000;
                lastOutTimeSec = sec;
                if (totalSeconds && totalSeconds > 0) {
                  const pct = Math.max(
                    0,
                    Math.min(100, Math.floor((sec / totalSeconds) * 100))
                  );
                  if (pct !== lastPercent) {
                    lastPercent = pct;
                    perSpinner.text = `Downloading "${title}" — ${pct}% (${formatTimeSec(
                      sec
                    )} / ${formatTimeSec(totalSeconds)}) ${
                      lastSpeed ? "• " + lastSpeed : ""
                    }`;
                  }
                } else {
                  perSpinner.text = `Downloading "${title}" — ${formatTimeSec(
                    sec
                  )} ${lastSpeed ? "• " + lastSpeed : ""}`;
                }
              } else if (k === "speed") {
                lastSpeed = v && v !== "N/A" ? `${v} speed` : "";

                if (totalSeconds && totalSeconds > 0 && lastOutTimeSec > 0) {
                  const pct = Math.max(
                    0,
                    Math.min(
                      100,
                      Math.floor((lastOutTimeSec / totalSeconds) * 100)
                    )
                  );
                  if (pct !== lastPercent) lastPercent = pct;
                  perSpinner.text = `Downloading "${title}" — ${pct}% (${formatTimeSec(
                    lastOutTimeSec
                  )} / ${formatTimeSec(totalSeconds)}) ${
                    lastSpeed ? "• " + lastSpeed : ""
                  }`;
                } else if (lastOutTimeSec > 0) {
                  perSpinner.text = `Downloading "${title}" — ${formatTimeSec(
                    lastOutTimeSec
                  )} ${lastSpeed ? "• " + lastSpeed : ""}`;
                }
              } else if (k === "progress" && v === "end") {
                perSpinner.succeed(`Finished "${title}"`);
              }
            }
          });

          child.stderr?.on("data", (buf: Buffer) => {
            const line = buf.toString().trim();
            if (line) perSpinner.text = `Downloading "${title}" — ${line}`;
          });

          await child;

          spinner.text = `Downloading videos... (${++count}/${total})`;
        } catch (e) {
          perSpinner.fail(`Failed "${title}"`);
          console.error(`\nFailed to download video: "${title}". Error:`, e);
        }
      },
      { concurrency: 3, stopOnError: false }
    );

    spinner.succeed(`Finished downloading ${count}/${total} videos.`);
  } catch (error) {
    spinner.fail("An error occurred during the process.");
    console.error(error);
  }
}
export async function download(
  _: never,
  token: string,
  link: string,
  output: string
) {
  return downloadVideo(token, link, output, ffmpeg);
}

async function probeDurationSeconds(
  ffmpegPath: string,
  url: string,
  userAgent?: string
): Promise<number | null> {
  try {
    const args = [
      "-hide_banner",
      ...(userAgent ? ["-user_agent", userAgent] : []),
      "-i",
      url,
      "-f",
      "null",
      "-",
    ];
    const { stderr } = await execa(ffmpegPath, args, { reject: false });
    const m = /Duration:\s+(\d+):(\d+):(\d+\.\d+)/.exec(stderr || "");
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = parseFloat(m[3]);
    return hh * 3600 + mm * 60 + ss;
  } catch {
    return null;
  }
}
function formatTimeSec(t: number) {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}
