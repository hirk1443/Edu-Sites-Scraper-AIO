import got from "got";
import ora from "ora";
import sharp from "sharp";
import { load } from "cheerio";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sanitizePath } from "./helper/sanitizePath.js";
import { mergeImgVertical } from "./helper/mergeImg.js";

export const website = "mapstudy.vn";

type ApiResponse<T extends Record<string, unknown>> = {
    code: "SUCCESS",
    data: T,
    extra: {}
} | {
    code: string,
    message: string,
    extra: {}
};

type AuthResponse = ApiResponse<{
    accessToken: string,
    refreshToken: string,
    refreshTokenExpiredTime: number
}>;

type Lesson = ApiResponse<{
    lesson: {
        name: string,
        isExamLesson: boolean,
        isTestLesson: boolean,
    }
}>;

type ExamHistory = ApiResponse<{
    data: Array<{
        id: number
    }>
}>;

type ExamAttempt = ApiResponse<{
    questions: Array<{
        additional: string;
        answerId: number;
        answers: Array<{
            id: number;
            name: string;  
        }>
        name: string;
    }>
}>;

export async function login(_: never, username: string, password: string)
{
    const res = await got.post("https://api.mapstudy.vn/api/v1/common/auth/login", {
        json: {
            usernameOrEmail: username,
            password
        }
    }).json<AuthResponse>();
    return "data" in res ? res.data.accessToken : null;
}

export async function logout() {}

async function downloadExam(token: string, id: string, output: string)
{
    const spinner = ora("Getting exam history...").start();
    const headers = { Authorization: "Bearer " + token };
    const history = await got(`https://api.mapstudy.vn/api/v1/lessons/${id}/lesson-exam-histories`,
        { headers }).json<ExamHistory>();
    if (!("data" in history))
    {
        spinner.fail("Error getting exam history");
        throw new Error(`Error getting exam history. Response: ${history}`);
    }
    if (!history.data.data.length)
    {
        spinner.stopAndPersist({ text: "Exam not finished, not downloading" });
        return;
    }
    spinner.text = "Getting exam attempt...";

    const attempt = await got(`https://api.mapstudy.vn/api/v1/lesson-exam-histories/${history.data.data[0].id}`,
        { headers }).json<ExamAttempt>();
    if (!("data" in attempt))
    {
        spinner.fail("Error getting exam attempt");
        throw new Error(`Error getting exam attempt. Response: ${attempt}`);
    }
    for (const [i, question] of attempt.data.questions.entries())
    {
        spinner.text = `Downloading question ${i + 1}/${attempt.data.questions.length}...`;
        const questionImgLink = load(question.name)("img").attr("src")!;
        const questionImg = await got(questionImgLink).buffer();
        const answer = question.answers.filter(x => x.id === question.answerId).map(x => x.name)[0];
        const answerImg = await sharp({
            text: {
                text: `Đáp án: ${load(answer).text()}`,
                font: "Times",
                dpi: 100
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
        await mergeImgVertical([questionImg, answerImg])
            .then(img => img.toFile(join(output, `${i + 1}.png`)));
    }
    spinner.succeed("Finished");
}

async function downloadVideo(token: string, id: string, output: string)
{

}

export async function download(_: never, token: string, link: string, output: string)
{
    let matches;
    if (matches = link.match(/https:\/\/mapstudy\.vn\/bai-giang\/\d+\/(?<id>\d+)\/.+/))
    {
        const id = matches.groups!["id"];
        const spinner = ora("Getting lesson details...").start();
        const headers = { Authorization: "Bearer " + token };
        const res = await got(`https://api.mapstudy.vn/api/v1/lessons/${id}`,
            { headers }).json<Lesson>();
        if ("data" in res)
        {
            spinner.stop();
            const title = res.data.lesson.name;
            const subdir = join(output, sanitizePath(title));
            await mkdir(subdir, { recursive: true });
            if (res.data.lesson.isExamLesson)
                return downloadExam(token, id, subdir);
        }
    }
}