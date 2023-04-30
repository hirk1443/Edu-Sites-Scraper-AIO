import got from "got";
import ora from "ora";
import pMap from "p-map";
import sharp from "sharp";
import { execa } from "execa";
import { load } from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg, yt_dlp } from "../tools.js";
import { sanitizePath } from "./helper/sanitizePath.js";
import { mergeImgVertical } from "./helper/mergeImg.js";

export const website = "vatlyhadong.vn";

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
        id: number,
        name: string,
        isExamLesson: boolean,
        isTestLesson: boolean,
        videos: VideoOrDocument[];
        thematic: {
            course: {
                id: number
            },
            id: number
        }
    }
}>;

type Course = ApiResponse<{
    course: {
        name: string;
        thematics: Array<{
            name: string;
            lessons: Array<{ id: number }>
        }>
    }
}>

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

type VideoInfo = ApiResponse<{
    video: {
        document: "";
        id: number;
        isDocument: false;
        isDriveUrl: boolean;
        isYoutubeUrl: boolean;
        m3u8: string;
        notes: string;
        videoUrl: string;
    }
}>

type VideoOrDocument = {
    id: number;
    name: string;
} & ({
    isDocument: false;
    document: "";
    duration: number;
    duration2: null;
} | {
    isDocument: true;
    document: string;
    duration: null;
    duration2: null;
})

export async function login(_: never, username: string, password: string)
{
    const res = await got.post("https://api.vatlyhadong.vn/api/v1/common/auth/login", {
        json: {
            usernameOrEmail: username,
            password
        },
        headers: {
            origin: "https://vatlyhadong.vn"
        }
    }).json<AuthResponse>();
    return "data" in res ? res.data.accessToken : null;
}

export async function logout() {}

async function downloadExam(token: string, id: string, output: string)
{
    const spinner = ora("Getting exam history...").start();
    const headers = { Authorization: "Bearer " + token, Origin: "https://vatlyhadong.vn" };
    const history = await got(`https://api.vatlyhadong.vn/api/v1/lessons/${id}/lesson-exam-histories`,
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

    const attempt = await got(`https://api.vatlyhadong.vn/api/v1/lesson-exam-histories/${history.data.data[0].id}`,
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
        const answerImg = await sharp({
            text: {
                text: `Đáp án: ${question.answers.filter(x => x.id === question.answerId).map(x => x.name)}`,
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

async function getVideoUrl(token: string, id: number)
{
    const headers = { Authorization: "Bearer " + token, Origin: "https://vatlyhadong.vn" };
    const res = await got(`https://api.vatlyhadong.vn/api/v1/videos/${id}`,
        { headers }).json<VideoInfo>();
    if ("data" in res) return res.data.video.videoUrl;
    return null;
}

async function downloadLesson(token: string, id: string, output: string)
{
    const spinner = ora("Getting lesson details...").start();
    const headers = { Authorization: "Bearer " + token, Origin: "https://vatlyhadong.vn" };
    const res = await got(`https://api.vatlyhadong.vn/api/v1/lessons/${id}`,
        { headers }).json<Lesson>();
    if ("data" in res)
    {
        spinner.stop();
        const title = res.data.lesson.name;
        const subdir = join(output, sanitizePath(title));
        await mkdir(subdir, { recursive: true });
        if (res.data.lesson.isExamLesson)
        {
            const subdirExam = join(subdir, "exams");
            await mkdir(subdirExam, { recursive: true });
            await downloadExam(token, id, subdir);
        }
        if (res.data.lesson.videos)
        {
            const spinner = ora("Downloading documents and videos...").start();
            const subdirVideos = join(subdir, "videos");
            const subdirDocuments = join(subdir, "documents");
            await mkdir(subdirVideos, { recursive: true });
            await mkdir(subdirDocuments, { recursive: true });
            await pMap(res.data.lesson.videos, async ({id, name, isDocument, document}) => {
                if (isDocument)
                {
                    const { thematic: {
                        course:
                            {
                                id: course_id
                            },
                            id: thematic_id
                        },
                        id: lesson_id
                    } = res.data.lesson;
                    const file = await got(
                        "https://vatlyhadong.sgp1.cdn.digitaloceanspaces.com"     +
                        `/courses/${course_id}/${thematic_id}/${lesson_id}/${id}` +
                        `/documents/${document}`
                    ).buffer();
                    await writeFile(join(subdirDocuments, document), file);
                }
                else
                {
                    const video = await getVideoUrl(token, id);
                    if (!video) return;
                    await execa(yt_dlp, [
                        "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b",
                        "-N", "8",
                        "-P", subdirVideos,
                        "-o", `${name}.%(ext)s`,
                        "--ffmpeg-location", ffmpeg!,
                        video
                    ]);
                }
            }, { concurrency: 5, stopOnError: false });
            spinner.succeed("Finished");
        }
    }
}

async function downloadCourse(token: string, id: string, output: string)
{
    const spinner = ora("Getting lesson details...").start();
    const headers = { Authorization: "Bearer " + token, Origin: "https://vatlyhadong.vn" };
    try
    {
        const res = await got(`https://api.vatlyhadong.vn/api/v1/courses/${id}`, 
            { headers }).json<Course>();
        if ("data" in res)
        {
            spinner.stop();
            const subdirCourse = join(output, sanitizePath(res.data.course.name));
            await mkdir(subdirCourse, { recursive: true });
            for (const thematic of res.data.course.thematics)
            {
                console.log(`Downloading ${thematic.name}`);
                const subdirThematic = join(subdirCourse, sanitizePath(thematic.name));
                await mkdir(subdirThematic, { recursive: true });
                for (const lesson of thematic.lessons)
                    await downloadLesson(token, lesson.id.toString(), subdirThematic);
            }
        }
    }
    catch (e)
    {
        spinner.fail("Failed to get course data");
        throw e;
    }
}

export async function download(_: never, token: string, link: string, output: string)
{
    let matches;
    if (matches = link.match(/https:\/\/vatlyhadong\.vn\/bai-giang\/\d+\/(?<id>\d+)\/.+/))
    {
        const id = matches.groups!["id"];
        await downloadLesson(token, id, output);
    }
    else if (matches = link.match(/https:\/\/vatlyhadong\.vn\/khoa-hoc\/(?<id>\d+)\/.+/))
    {
        const id = matches.groups!["id"];
        await downloadCourse(token, id, output);
    }
}