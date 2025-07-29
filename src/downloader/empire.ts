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

async function downloadVideo(token: string, id: string, output: string) {
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

        if (resource?.type === "video") {
          videoResources.push(resource);
        }
      }
    } else {
      spinner.fail("Could not find 'resources' array in the lesson response.");
      return;
    }
    if (videoResources.length > 0) {
      spinner.succeed(
        `Successfully filtered ${videoResources.length} video(s) from lesson "${response.lesson.title}".`
      );

      console.log("--- Video Resources Found ---");
      const simplifiedVideoList = videoResources.map((v) => ({
        title: v.title,
        url: v.fileUrl,
      }));

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
        choices,
        async (video: VideoResource, i) => {
          try {
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

            const sanitizedTitle = sanitizePath(video.title);

            await execa(yt_dlp, [
              "-f",
              "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b",
              "-N",
              "8",
              "-P",
              subdir_videos,
              "-o",
              `${i + 1}. ${sanitizedTitle}.%(ext)s`,
              "--ffmpeg-location",
              ffmpeg!,
              videoUrl.url,
            ]);

            spinner.text = `Downloading videos... (${++count}/${total})`;
          } catch (e) {
            console.error(
              `\nFailed to download video: "${video.title}". Error:`,
              e
            );
          }
        },
        { concurrency: 3, stopOnError: false }
      );

      spinner.succeed(`Finished downloading ${count}/${total} videos.`);
    } else {
      spinner.fail("No videos found in this lesson.");
    }
  } catch (error) {
    spinner.fail("An error occurred during the process.");
  }
}

export async function download(
  _: never,
  token: string,
  link: string,
  output: string
) {
  let matches;
  if ((matches = (link as string).match(/https:\/\/empire\.edu\.vn\/khoa-hoc/)))
    return downloadVideo(token, link, output);
}
