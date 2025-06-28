import got from "got";
import pMap from "p-map";
import ora from "ora";
import { execa } from "execa";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { aria2c } from "../tools.js";
import { toToughCookieJar } from "./helper/toToughCookieJar.js";
import { sanitizePath } from "./helper/sanitizePath.js";

import type { BrowserContext, ScreenshotOptions } from "puppeteer";

export const website = "vted.vn";

export async function login(
  browser: BrowserContext,
  email: string,
  password: string
) {
  const page = await browser.newPage();
  await page.goto("https://account.vted.vn/Account/Login");
  await page.type("#Email", email);
  await page.type("#Password", password);

  try {
    await Promise.all([
      page.click("input[type=submit]"),
      page.waitForNavigation({ waitUntil: "networkidle0" }),
    ]);
  } catch (error) {
    // Bỏ qua lỗi timeout
  }

  let cookies: [string, string][] | null;
  if (page.url() === "https://account.vted.vn/Account/Login") cookies = null;
  else cookies = (await page.cookies()).map(({ name, value }) => [name, value]);
  await page.close();
  return cookies;
}

export async function logout(browser: BrowserContext) {
  const page = await browser.newPage();
  await page.goto("https://vted.vn");
  await page.$eval("form#logoutForm", (el) => (el as HTMLFormElement).submit());
  await page.close();
}

async function downloadLesson(
  browser: BrowserContext,
  link: string,
  output: string
) {
  const spinner = ora("Loading page...").start();
  const page = await browser.newPage();
  await page.goto(link);

  const title = await page.$eval(".lesson-detail h4", (el) =>
    el.textContent!.trim()
  );
  const videoLinks = [
    link,
    ...(await page.$$eval("a.btn[href^='/khoa-hoc/baigiang']", (elems) =>
      (elems as HTMLAnchorElement[]).map((el) => el.href)
    )),
  ];

  spinner.text = "Getting video links...";
  let finished = 0;
  const videoInfo = await pMap(
    videoLinks,
    async (link) => {
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.goto(link, { waitUntil: "domcontentloaded" });
      const title = await page
        .$eval(
          "input[type='button'][disabled]",
          (el) => (el as HTMLInputElement).value
        )
        .catch(() => "video");

      const videoFrameUrl = await page.$eval(
        ".asyncVideo",
        (el) => "https://vted.vn" + el.getAttribute("data-url")
      );
      await page.goto(videoFrameUrl, { waitUntil: "domcontentloaded" });
      const videoLink = await page.$eval(
        "video",
        (el) => (el as HTMLVideoElement).src
      );
      await page.close();
      ++finished;
      spinner.text = `Getting video links ${finished}/${videoLinks.length}...`;
      return { title, link: videoLink };
    },
    { concurrency: 5 }
  );

  await page.close();
  spinner.stopAndPersist({
    symbol: "",
    text: "Downloading videos using aria2c...",
  });
  const subdir = join(output, sanitizePath(title));
  await mkdir(subdir, { recursive: true });
  const aria2cInput = videoInfo
    .map(({ link, title }) => `${link}\n out=${sanitizePath(title)}.mp4\n`)
    .join("");
  const tempFile = join(subdir, `aria2-list-${randomUUID()}.tmp`);
  await writeFile(tempFile, aria2cInput);

  await execa(
    aria2c,
    [
      "-i",
      tempFile,
      "-d",
      subdir,
      "-x",
      "16",
      "-s",
      "8",
      "-k",
      "5M",
      "--referer=https://vted.vn",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36 Edg/108.0.1462.54",
      "--summary-interval=0",
      "--retry-wait=1",
    ],
    {
      stdio: "inherit",
    }
  );
  await unlink(tempFile);
}

async function downloadExam(
  browser: BrowserContext,
  link: string,
  output: string
) {
  const spinner = ora("Loading page...").start();
  const page = await browser.newPage();
  await page.goto(link);

  const pdfAvailable = !!(await page.$(".lesson-detail-info .fa-file-pdf-o"));
  const title = await page.$eval(".lesson-detail-header h2", (el) =>
    el.textContent!.trim()
  );
  const subdir = join(output, sanitizePath(title));
  await mkdir(subdir, { recursive: true }).catch(() => {});

  const answerLink = await page.$eval(
    "a[href^='/practice/practiceresult']",
    (el) => (el as HTMLAnchorElement).href
  );
  await page.goto(answerLink);
  await page.setViewport({
    width: 1920,
    height: 1080,
  });
  await page.$eval("#menutop-sticky-wrapper", (el) => el.remove());
  if (pdfAvailable) {
    spinner.text = "Downloading PDF...";
    const pdfLink = await page.$eval(
      "a[href^='/practice/download']",
      (el) => (el as HTMLAnchorElement).href
    );
    // Lỗi 1: Sửa lỗi kiểu Cookie
    const cookies = await page.cookies();
    await got(pdfLink, {
      cookieJar: await toToughCookieJar(cookies, "https://vted.vn"),
    })
      .buffer()
      .then((buf) => writeFile(join(subdir, "Đề bài.pdf"), buf));
  }

  spinner.text = "Fetching answers...";
  await page.$$eval(".panel-body .answer", (elems) =>
    elems.forEach((e) => e.remove())
  );
  const answers = await page.$$(".answer");
  if (!answers.length) {
    spinner.fail("No answers found! Please report");
    return;
  }
  for (let [i, answer] of answers.entries()) {
    ++i;
    spinner.text = `Capturing question ${i}/${answers.length} (${(
      (i * 100) /
      answers.length
    ).toFixed(0)}%)...`;
    await answer.evaluate((e) => {
      e.classList.remove("lock");
      e.classList.add("block");
    });
    await answer.$eval(".explain-question a", (el) =>
      (el as HTMLElement).click()
    );

    // Lỗi 2: Sửa lỗi screenshot path
    const screenshotPath = join(subdir, `${i}.png`);
    await answer.screenshot({
      type: "png",
      path: screenshotPath,
    } as ScreenshotOptions); // Ép kiểu để khớp với yêu cầu

    await answer.evaluate((e) => {
      e.classList.remove("block");
      e.classList.add("lock");
    });
  }
  spinner.succeed("Finished!");
  await page.close();
}

export async function download(
  ctx: BrowserContext,
  _: never,
  link: string,
  output: string
) {
  if (/https:\/\/vted\.vn\/on-tap\/.+/.test(link))
    return downloadExam(ctx, link, output);
  if (/https:\/\/vted\.vn\/khoa-hoc\/baigiang.+/.test(link))
    return downloadLesson(ctx, link, output);
}
