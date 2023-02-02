import { execa } from "execa";
import got from "got";
import { zip } from "lodash-es";
import ora from "ora";
import pMap from "p-map";
import QuickLRU from "quick-lru"
import { proxy } from "../proxy.js";
import { yt_dlp, ffmpeg } from "../tools.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { mergeImgVertical } from "./helper/mergeImg.js";
import { sanitizePath } from "./helper/sanitizePath.js";
import { toToughCookieJar } from "./helper/toToughCookieJar.js";

import type { Mockttp } from "mockttp";
import type { BrowserContext, Page, ElementHandle } from "puppeteer";

export const website = "moon.vn";

async function blockAdsJs(page: Page)
{
    await page.setRequestInterception(true);
    page.on("request", e => {
        if (e.isInterceptResolutionHandled()) return;
        return e.url().toLowerCase().includes("mepuzz") ? e.abort("failed") : e.continue();
    })
}

export async function login(browser: BrowserContext, username: string, password: string)
{
    const page = await browser.newPage();
    await page.goto("https://moon.vn/login");
    await page.type(".field input[type='text']", username);
    await page.type(".field input[type='password']", password);
    await Promise.all([
        page.click(".field input[type='button']"),
        delay(5000)
    ]);
    let cookies: [string, string][] | null;
    if (page.url() !== "https://moon.vn/")
        cookies = null;
    else
        cookies = (await page.cookies()).map(({name, value}) => [name, value]);
    await page.close();
    return cookies;
}

export async function logout(browser: BrowserContext)
{
    const page = await browser.newPage();
    await blockAdsJs(page);
    await page.goto("https://moon.vn", { waitUntil: "networkidle2" });
    await page.waitForSelector(".mud-avatar-medium", { timeout: 5000 }).then(el => el?.click());
    await page.waitForXPath("//a[contains(text(), 'Đăng xuất')]", { timeout: 5000 }).then(
        el => (el as ElementHandle<Element>).click()
    );
    await page.close();
}

async function downloadExam(browser: BrowserContext, link: string, output: string)
{
    const spinner = ora("Loading page...").start();
    const page = await browser.newPage();
    await blockAdsJs(page);
    await page.goto(link, { waitUntil: "networkidle2" });
    await page.setViewport({ width: 1920, height: 1080 });
    
    spinner.text = "Checking for unfinished exam...";
    await page.waitForSelector("p:first-of-type input.bigRadio", { timeout: 2000 })
    .then(() => page.$$eval("p:first-of-type input.bigRadio", elems => elems.map(el => el.click())))
    .then(() => page.reload({ waitUntil: "networkidle2" }))
    .catch(() => {});

    await page.waitForSelector(".btn-info:last-of-type", { timeout: 3000 }).then(el => el?.click());
    await page.waitForNetworkIdle();
    const title = await page.$eval(".ask-header p", el => el.textContent!);
    const subdir = join(output, sanitizePath(title!));
    await mkdir(subdir, { recursive: true }).catch(() => {});
    
    spinner.text = "Downloading audio..."
    const audioLinks = await page.$$eval("div[id^='icecast_']", elems => elems.map(
        // @ts-expect-error
        el => window.flowplayer(el).conf.sources[0].src as string
    ));

    spinner.text = "Capturing answer keys...";
    await page.waitForSelector(".table-bordered", { timeout: 3000 })
    .then(elem => elem?.screenshot({ path: join(subdir, "answerKey.png") }))
    .catch(() => {});
    const sections = await page.$$("section[id^='Key_']");
    await page.$$eval("table tr td[align='right'] a", elems => elems.map(el => el.click()));
    
    spinner.text = "Removing comments...";
    await (async () => {
        let handle;
        while (handle = await page.waitForSelector("div[style='padding:15px;background-color:#e6eaef;']", {
            timeout: 1000
        }).catch(() => null))
            await handle.evaluate(el => el.remove());
    })()

    for (let [i, section] of sections.entries())
    {
        ++i;
        spinner.text = `Capturing question ${i}/${sections.length} (${(i * 100/sections.length).toFixed(0)}%)...`;
        const handles = [];

        const question = await section.evaluateHandle(e => e.nextElementSibling!);
        handles.push(question);

        const choices = await question.evaluateHandle(e => e.nextElementSibling!);
        handles.push(choices);

        const answer = await choices.evaluateHandle(e => e.nextElementSibling!);
        handles.push(answer);

        const maybeExplain = await answer.evaluateHandle(e => e.nextElementSibling!);
        if (await maybeExplain.evaluate(e => e.classList.contains("noselect")))
            handles.push(maybeExplain);

        const imgList = [];
        for (const handle of handles)
            imgList.push(await handle.screenshot());
        await mergeImgVertical(imgList)
            .then(img => img.toFile(join(subdir, `${i}.png`)));
        
        await Promise.all(handles.map(handle => handle.evaluate(el => el.remove())));
    }
    spinner.succeed(`Finished capturing ${sections.length} questions!`);
    await page.close();
}

type ApiResponse = {
    success: true,
    url: string
} | {
    success: undefined,
    Succeeded: false,
    Errors: Array<string>
}

async function downloadVideo(browser: BrowserContext, link: string, output: string)
{
    const spinner = ora("Loading page...").start();
    const page = await browser.newPage();
    await page.goto(link);

    spinner.text = "Getting lesson title...";
    const title = (await page.waitForSelector(".ask-header p", { timeout: 5000 })
    .then(el => el?.evaluate(el => el.textContent!)))!;

    const subdir = join(output, sanitizePath(title));
    await mkdir(subdir, { recursive: true }).catch(() => {});

    spinner.text = "Getting video titles...";
    const videoTitles = (await page.waitForSelector(".video-right", { timeout: 5000 })
    .then(list => list?.$$eval("div > div > span", els => els.map(el => el.textContent!.trim()))))!;

    spinner.text = "Getting video links...";
    const videoLinks = await page.waitForSelector(".fp-playlist", { timeout: 5000 })
    .then(list => list?.$$eval("a", els => els.map(el => el.href)))
    .then(vods => pMap(vods!, async (vod) => {
        const res = await got.post(vod.replace("vod", "api/video/getvideourl"), {
            cookieJar: await toToughCookieJar(await page.cookies(), "https://moon.vn")
        }).json<ApiResponse>();
        return res.success ? res.url : ""
    }, { concurrency: 5 }));
    await page.close();

    spinner.text = "Downloading videos using yt-dlp...";
    let video_finished = 0;
    await pMap(zip(videoTitles, videoLinks), ([title, link]) =>
        execa(yt_dlp, [
            "-N", "8",
            "-P", subdir,
            "-o", `${title}.%(ext)s`,
            "--ffmpeg-location", ffmpeg!,
            "--proxy", proxy.url,
            "--no-check-certificates",
            link!
        ], { stdio: "ignore" })
        .then(() =>
            spinner.text = `Downloading videos using yt-dlp... (${++video_finished}/${videoLinks.length})`
        ),
    { concurrency: 5 });
    spinner.succeed("Finished!");
}

const idToUrlCache = new QuickLRU<string, string>({ maxSize: 100 });
const encryptionKeyCache = new QuickLRU<string, Buffer>({ maxSize: 100 });
proxy.forGet(/https:\/\/moonbook\.vn\/video\/AuthenticateLocal/).thenPassThrough({
    beforeRequest: ({ id, url }) => {
        idToUrlCache.set(id, url);
    },
    beforeResponse: ({ id, body }) => {
        const url = idToUrlCache.get(id)!;
        const cachedKey = encryptionKeyCache.get(url)
        if (!cachedKey)
            encryptionKeyCache.set(url, body.buffer);
        else return {
            statusCode: 200,
            body: cachedKey
        }
    }
});

export async function download(ctx: BrowserContext, _: never, link: string, output: string)
{
    ora("This downloader is not stable! (and will never be). Proceed on your own.").start().warn();
    if (/https:\/\/moon\.vn\/(de-thi\/id|english-id)\/\d+\/\d+/.test(link))
        return downloadExam(ctx, link, output);
    if (/https:\/\/moon\.vn\/video\/id\/\d+\/\d+/.test(link))
        return downloadVideo(ctx, link, output);
}
