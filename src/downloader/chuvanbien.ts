import ora from "ora";
import pMap from "p-map";
import { execa } from "execa";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { aria2c } from "../tools.js";
import { sanitizePath } from "./helper/sanitizePath.js";

import type { BrowserContext } from "puppeteer";

export const website = "chuvanbien.vn";

export async function login(ctx: BrowserContext, username: string, password: string)
{
    const page = await ctx.newPage();
    await page.goto("https://chuvanbien.vn/index.php?module=members&view=signin");
    await page.type("#account", username);
    await page.type("#pass", password);
    await Promise.all([
        page.click("#signin-btn"),
        page.waitForNavigation()
    ]);
    let cookies: [string, string][] | null;
    if (page.url() !== "https://chuvanbien.vn/")
        cookies = null;
    else
        cookies = (await page.cookies()).map(({name, value}) => [name, value]);
    await page.close();
    return cookies;
}

export async function logout(browser: BrowserContext)
{
    const page = await browser.newPage();
    await page.goto("https://chuvanbien.vn/index.php?module=members&view=members&task=logout");
    await page.close();
}

async function downloadLesson(browser: BrowserContext, link: string, output: string)
{
    const spinner = ora("Loading page...").start();
    const page = await browser.newPage();
    await page.goto(link);

    const title = await page.$eval(".video-header span", el =>
        (el.textContent?.match(/(.+)( \(\d+:\d+\))?/)!)[0]
    );
    const videoLinks = await page.$$eval(".list-menus ul li a", elems => elems.map(el => el.href));

    spinner.text = "Getting video links...";
    let finished = 0;
    const videoInfo = await pMap(videoLinks, async (link) => {
        const page = await browser.newPage();
        await page.setJavaScriptEnabled(false);
        await page.goto(link);
        const title = await page.$eval(".course-dt-title-video", el => el.textContent!);
        const videoLink = await page.$eval("#video-detail source", el => el.src);
        await page.close();
        ++finished;
        spinner.text = `Getting video links ${finished}/${videoLinks.length}...`;
        return { title, link: videoLink };
    }, { concurrency: 5 });

    await page.close();
    spinner.info("Downloading videos using aria2c...");
    const subdir = join(output, sanitizePath(title));
    await mkdir(subdir, { recursive: true });
    const aria2cInput = videoInfo.map(({link, title}) => `${link}\n out=${sanitizePath(title)}.mp4\n`).join("");
    const tempFile = join(subdir, `aria2-list-${randomUUID()}.tmp`);
    await writeFile(tempFile, aria2cInput);

    await execa(aria2c, [
        "-i", tempFile,
        "-d", subdir,
        "-x", "16",
        "-s", "8",
        "-k", "5M",
        "--summary-interval=0",
        "--retry-wait=1"
    ], {
        stdio: "inherit"
    });
    await unlink(tempFile);
}

export async function download(ctx: BrowserContext, _: never, link: string, output: string)
{
    if (/https:\/\/chuvanbien\.vn\/.+\/video\d+\.html/.test(link))
        return downloadLesson(ctx, link, output);
}
