import got from "got";
import ora from "ora";
import pMap from "p-map";
import sharp from "sharp";
import { load } from "cheerio";
import { execa } from "execa";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg, yt_dlp } from "../tools.js";
import { sanitizePath } from "./helper/sanitizePath.js";
import { mergeImgVertical } from "./helper/mergeImg.js";

export const website = "luyenthitiendat.vn";

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
        question: string | null,
        answer: AnswerChoice,
        level: string
    }>
}>

type Answer = ApiResponse<{
    _id: string,
    answer: AnswerChoice,
    answer_content: string | null,
    v_id: string,
    video_link: string
}>

export async function login(_: never, email: string, password: string)
{
    const {code, data} = await got.post("https://api.luyenthitiendat.vn/auth/signin", {
        json: { email, password }
    }).json<AuthResult>();
    return code === 200 ? data.token : null;
}

export async function logout() {}

async function downloadExam(token: string, id: string, output: string)
{
    const headers = { Authorization: token };
    const spinner = ora("Getting exam details...").start();
    const { code, data, message } = await got.post("https://api.luyenthitiendat.vn/testing/detail", {
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
    const videoLinks = await pMap(questions, async ({_id: id, question, answer}, i) => {
        ++i;
        const { code, data } = await got.post("https://api.luyenthitiendat.vn/question/answer", {
            json: { id },
            headers
        }).json<Answer>();
        if (code !== 200)
            throw new Error("This should never happen, something is really wrong!");
        const { video_link, answer_content } = data;

        if (question)
        {
            const questionImgLink = load(question)("img").attr("src")!;
            const questionImg = await got(questionImgLink).buffer();
            let answerImg: Buffer;

            if (answer_content)
            {
                const answerImgLink = load(answer_content)("img").attr("src")!;
                answerImg = await got(answerImgLink).buffer();
            }
            else
            {
                answerImg = await sharp({
                    text: {
                        text: `Đáp án: Câu ${answer}`,
                        font: "Times",
                        dpi: 200
                    }
                })
                .negate()
                .extend({
                    top: 20,
                    bottom: 20,
                    left: 20,
                    background: "white"
                })
                .png()
                .toBuffer();
            }

            await mergeImgVertical([questionImg, answerImg])
                .then(img => img.toFile(join(subdir_images, `${i}.png`)));
        }
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

    spinner.text = "Downloading videos using yt-dlp...";
    const subdir_videos = join(subdir, "videos");
    await mkdir(subdir_videos).catch(() => {});
    let count = 0;
    const total = videoLinks.filter(link => !!link).length;
    await pMap(videoLinks, async (video, i) => {
        if (!video) return;
        await execa(yt_dlp, [
            "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b",
            "-N", "8",
            "-P", subdir_videos,
            "-o", `${i + 1}.%(ext)s`,
            "--ffmpeg-location", ffmpeg!,
            video
        ]);
        spinner.text = `Downloading videos using yt-dlp... (${++count}/${total})`;
    }, { concurrency: 5, stopOnError: false }).catch(e => {
        spinner.fail("Download videos incomplete, something happened");
        throw e;
    });
    spinner.succeed("Finished!");
}

export async function download(_: never, token: string, link: string, output: string)
{
    let matches;
    if (matches = (link as string).match(
        /https:\/\/app\.luyenthitiendat\.vn\/app\/classrooms\/[0-9a-f]{24}\/testings\/(?<id>[0-9a-f]{24})/
    ))
        return downloadExam(token, matches.groups!["id"], output);
}
