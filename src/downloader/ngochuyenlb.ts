// This is so similar to luyenthitiendat that it has to be from the same person

import got from "got";
import ora from "ora";
import pMap from "p-map";
import { load } from "cheerio";
import { execa } from "execa";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg, yt_dlp, aria2c } from "../tools.js";
import { sanitizePath } from "./helper/sanitizePath.js";

export const website = "ngochuyenlb.edu.vn";

type ApiResponse<T extends Record<string, unknown>> = { message: string } & ({
    code: 200;
    data: T;
} | {
    code: 401 | 500;
    data: {};
}) 

type AuthResult = ApiResponse<{
    token: string;
}>

type AnswerChoice = "A" | "B" | "C" | "D";

type Exam = ApiResponse<{
    exam: {
        _id: string,
        alias: string,
        name: string,
        questions: Array<string>
    },
    questions: Array<{
        _id: string,
        question: string,
        answer: AnswerChoice,
        level: string
    }>
}>

type Answer = ApiResponse<{
    _id: string,
    video_link: string
}>

export async function login(_: never, email: string, password: string)
{
    const {code, data} = await got.post("https://api.ngochuyenlb.edu.vn/auth/signin", {
        json: { email, password }
    }).json<AuthResult>();
    return code === 200 ? data.token : null;
}

export async function logout() {}

async function downloadExam(token: string, id: string, output: string)
{
    const headers = { Authorization: token };
    const spinner = ora("Getting exam details...").start();
    const { code, data, message } = await got.post("https://api.ngochuyenlb.edu.vn/testing/detail", {
        json: { id },
        headers
    }).json<Exam>();
    if (code !== 200)
    {
        spinner.fail("Failed getting exam details! Error: " + message);
        return;
    }
    const { exam, questions } = data;
    const { name: title } = exam;
    const subdir = join(output, sanitizePath(title.trim()));
    await mkdir(subdir, { recursive: true }).catch(() => {});

    spinner.text = "Downloading questions...";
    let question_finished = 0;

    const subdir_images = join(subdir, "images");
    await mkdir(subdir_images).catch(() => {});
    const videoLinks = await pMap(questions, async ({_id: id, question}, i) => {
        ++i;
        const questionImgLink = load(question)("img").attr("src")!;
        const questionImg = await got(questionImgLink).buffer();
        await writeFile(join(subdir_images, `${i}.png`), questionImg);

        const { code, data } = await got.post("https://api.ngochuyenlb.edu.vn/question/answer", {
            json: { id },
            headers
        }).json<Answer>();
        if (code !== 200)
            throw new Error("This should never happen, something is really wrong!");
        
        const { video_link } = data;
        
        spinner.text = `Downloading questions... (finished: ${++question_finished}/${questions.length})`
        if (!video_link || video_link === "null") return null;

        let matches;
        if (matches = video_link.match(/https:\/\/vimeo\.com\/(?<id>\d+)/))
            return "https://player.vimeo.com/video/" + matches.groups!["id"];
        return video_link;
    }, { concurrency: 10, stopOnError: false }).catch((e) => {
        spinner.fail("Download questions incomplete, something happened");
        throw e;
    });

    spinner.stopAndPersist({
        text: "Downloading videos using yt-dlp..."
    });
    const subdir_videos = join(subdir, "videos");
    await mkdir(subdir_videos).catch(() => {});
    await writeFile(join(subdir_videos, "link.txt"), videoLinks.map(link => link + '\n').join(""));
    await pMap(videoLinks, async (video, i) => {
        if (!video) return;
        await execa(yt_dlp, [
            "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b",
            "-N", "8",
            "-P", subdir_videos,
            "-o", `${i + 1}.%(ext)s`,
            "--ffmpeg-location", ffmpeg!,
            "--compat-options", "no-external-downloader-progress",
            "--downloader", aria2c,
            "--downloader-args", "aria2c:-x16 -s16",
            video
        ], {
            stdio: "inherit"
        });
    }, { concurrency: 1, stopOnError: false });
    spinner.succeed("Finished!");
}

export async function download(_: never, token: string, link: string, output: string)
{
    let matches;
    if (matches = (link as string).match(
        /https:\/\/ngochuyenlb\.edu\.vn\/testing\/(?<id>[0-9a-f]{24})/
    ))
        return downloadExam(token, matches.groups!["id"], output);
}
