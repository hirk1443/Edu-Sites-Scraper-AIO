import ora from "ora";
import pMap from "p-map";
import { execa } from "execa";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { sanitizePath } from "./helper/sanitizePath.js";
import { yt_dlp } from "../tools.js";

import type { BrowserContext, ElementHandle } from "puppeteer";

export const website = "hocmai.vn";

export async function login(ctx: BrowserContext, username: string, password: string)
{
    const page = await ctx.newPage();
    await page.goto("https://hocmai.vn/loginv2/");
    await page.type("#username", username);
    await page.type("#password", password);
    await Promise.all([
        page.click(".register-btn"),
        page.waitForNavigation()
    ]);
    let cookies;
    if (page.url() === "https://hocmai.vn/course/mycourse2.php")
        cookies = (await page.cookies()).map(({name, value}) => [name, value]);
    else
        cookies = null;
    await page.close();
    return cookies;
}

export async function logout(ctx: BrowserContext)
{
    const page = await ctx.newPage();
    await page.goto("https://hocmai.vn/user/profile/");
    await page.click("a.logout");
}

async function downloadLesson(ctx: BrowserContext, link: string, output: string)
{
    const spinner = ora("Loading page...").start();
    const page = await ctx.newPage();
    await page.goto(link);

    const title = await page.$eval(".scorm-name", el => el.textContent!);
    const subdir = join(output, sanitizePath(title));
    await mkdir(subdir, { recursive: true }).catch(() => {});

    spinner.text = "Getting video links...";
    type VideoInfo = {
        path: string[];
        link: string;
    }

    const playlist = await page.$eval("ul.playlist", el => {
        // @ts-expect-error
        const player = window.videojs("hocmaiplayer");
        const list: VideoInfo[] = [];
        const path: string[] = [];

        const buildVideoList = (el: HTMLUListElement) => {
            if (!el.classList.contains("scorm-detail-playlist"))
                throw new Error("Not a playlist element!");
            for (const elem of el.children)
            {
                const title = [...elem.childNodes]
                    .filter(node => node.nodeType === Node.TEXT_NODE)
                    .map(node => node.textContent!)
                    .join("").trim();
                path.push(title);
                if (elem.classList.contains("with-video-play"))
                {
                    const position = parseInt(elem.getAttribute("position")!);
                    const link = player.playlist()[position].sources[0].src;
                    list.push({ path: [...path], link });
                }
                else if (!elem.classList.length)
                {
                    const childList = elem.querySelector("ul")!;
                    buildVideoList(childList);
                }
                path.pop();
            }
        }
        
        buildVideoList(el);
        return list;
    });
    
    await page.close();

    spinner.text = "Downloading video...";
    let count = 0;
    await pMap(playlist, async ({path, link}) => {
        const title = path.pop();
        await execa(yt_dlp, [
            "-N", "8",
            "-P", join(subdir, ...path.map(frag => sanitizePath(frag))),
            "-o", `${title}.%(ext)s`,
            "--user-agent", await ctx.browser().userAgent(),
            link
        ]);
        spinner.text = `Downloading video... (${++count}/${playlist.length})`;
    }, { concurrency: 5, stopOnError: false });
    spinner.succeed("Finished!");
}

async function downloadExam(ctx: BrowserContext, link: string, output: string)
{
    const spinner = ora("Loading page...").start();
    const page = await ctx.newPage();
    await page.goto(link);
    await page.$eval("#modalReQuiez", el => el.remove());
    const attemptId = await page.$eval("input[name='attemptid']",
        el => el.value
    );
    await page.$eval("#pauseModal", el => {
        el.classList.remove("fade");
        el.setAttribute("style", "display: block;");
    });
    await page.click(".test-save");

    await page.goto(`https://hocmai.vn/mod/quiz/nen-tang/print2.php?attempt=${attemptId}`);
    await page.setViewport({ width: 1920, height: 1080 });
    spinner.text = "Waiting for answer page to initialize...";
    await page.waitForSelector(".print_subject_guide", { visible: true, timeout: 0 });

    const title = await page.$eval(".test-page-title", el => el.textContent!.trim());
    const subdir = join(output, sanitizePath(title));
    await mkdir(subdir, { recursive: true }).catch(() => {});

    spinner.text = "Grabbing PDF...";
    await page.evaluate(() => {
        // @ts-expect-error
        window.$fontSize = "16";

        // @ts-expect-error
        window.$printMode = 2;

        window.print = () => {};
        window.dispatchEvent(new Event("hmbeforeprint"));
    });
    await page.pdf({ path: join(subdir, "exam.pdf") });
    await page.close();
    spinner.succeed("Finished!");
}

export async function download(ctx: BrowserContext, _: never, link: string, output: string)
{
    if (
        /https:\/\/hocmai\.vn\/mod\/quiz\/nen-tang\/attempt\.php\?q=\d+/.test(link) ||
        /https:\/\/hocmai\.vn\/de-thi-truc-tuyen\/\d+\/.+\.html/.test(link)
    )
        return downloadExam(ctx, link, output);

    if (/https:\/\/hocmai.vn\/bai-giang-truc-tuyen\/\d+\/.+\.html/.test(link))
        return downloadLesson(ctx, link, output);
}