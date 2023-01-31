import got from "got";
import ora from "ora";
import pMap from "p-map";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitizePath } from "./helper/sanitizePath.js";
import { mergeImgVertical } from "./helper/mergeImg.js";

import type { Browser, BrowserContext, ElementHandle } from "puppeteer";

export const website = "ngoaingu24h.vn";

export async function login(browser: BrowserContext, username: string, password: string)
{
    const page = await browser.newPage();
    await page.goto("https://ngoaingu24h.vn");
    await page.click(".login_");
    await page.type("#account-input", username);
    await page.type("#password-input", password);
    await Promise.all([
        page.click(".btn-login-v1"),
        page.waitForNavigation()
    ]);
    let cookies: [string, string][] | null;
    if (page.url() === "https://ngoaingu24h.vn/tat-ca-khoa-hoc?category=my-course")
        cookies = (await page.cookies()).map(cookie => [cookie.name, cookie.value]);
    else
        cookies = null;
    await page.close();
    return cookies;
}

async function downloadExam(browser: Browser, _: never, link: string, output: string)
{
    const spinner = ora("Loading page...").start();
    const page = await browser.newPage();
    await page.goto(link);

    const title = await page.$eval(".path-panel-style a.active", el => el.textContent!);
    const subdir = join(output, sanitizePath(title));
    await mkdir(subdir, { recursive: true }).catch(() => {});

    spinner.text = "Downloading documents...";
    const docsInfo = await page.$$eval(".document-item a.view", elems => elems.map(
        el => { return { name: el.textContent!, link: el.href } }
    ));
    await pMap(docsInfo, async ({ name, link }) => {
        const content = await got(link).buffer();
        await writeFile(join(subdir, name), content);
    }, { concurrency: 5 });

    await page.$x("//button[contains(text(), 'Xem giải chi tiết')]")
        .then(elems => (elems[0] as ElementHandle<Element>).click());
    await page.waitForSelector("#main-game-panel");

    spinner.text = "Capturing questions...";
    const total = await page.$$eval("div[id^='childQuestion-']", elems => elems.length);
    let count = 0;

    const sections = await page.$$("#paragrapmainPanel");
    for (const section of sections)
    {
        const common = await section.$(".mainParaQuestion").then(el => el!.screenshot());
        const questions = await section.$$("div[id^='childQuestion-']");
        for (const question of questions)
        {
            ++count;
            spinner.text = `Capturing questions ${count}/${total} (${(count * 100 / total).toFixed(0)}%)`;
            const name = await question.evaluate(
                el => (parseInt(el.id.split("-")[1]) + 1).toString() + ".png"
            );
            await mergeImgVertical([
                common, await question.screenshot()
            ]).then(img => img.toFile(join(subdir, name)));
        }
    }
    spinner.succeed("Finished!");
}

export async function download(ctx: BrowserContext, _: never, link: string, output: string)
{

}
