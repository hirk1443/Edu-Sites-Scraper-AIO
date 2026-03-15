import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import Conf from "conf";
import ora from "ora";
import { globby } from "globby";
import { createMachine, interpret, assign, actions } from "xstate";
import prompts from "prompts";

import { proxy } from "./proxy.js";

import type { Browser, BrowserContext } from "puppeteer";

type Downloader = {
  website: string;
  login: (
    ctx: BrowserContext,
    username: string,
    password: string,
  ) => Promise<unknown>;
  loginUsingToken: (
    ctx: BrowserContext,
    token: string,
  ) => Promise<unknown>;
  logout: (ctx: BrowserContext, pageCtx: unknown) => Promise<void>;
  download: (
    ctx: BrowserContext,
    pageCtx: unknown,
    link: string,
    output: string,
  ) => Promise<void>;
};

const loadingSpinner = ora("Loading downloaders...").start();
const filePath = await globby("./downloader/*.js", {
  cwd: new URL(".", import.meta.url),
});
const downloaders: Downloader[] = await Promise.all(
  filePath.map((path) => import(new URL(path, import.meta.url).toString())),
);
loadingSpinner.succeed("Loaded downloaders!");

const config = new Conf();

type MachineContext = Partial<{
  browser: Browser;

  confPrefix: string;
  downloader: Downloader;

  browserContext: BrowserContext;
  pageContext: unknown;
}>;

type SiteSelectionResult = {
  confPrefix: string;
  downloader: Downloader;
  loginUsingAuthorization: boolean;
};

const machine = createMachine<MachineContext>({
  predictableActionArguments: true,
  id: "download",
  initial: "init",
  context: {},
  states: {
    init: {
      invoke: {
        id: "initPuppeteer",
        src: () => {
          const spinner = ora("Starting Puppeteer...").start();
          puppeteer.use(StealthPlugin());
          const browser = puppeteer.launch({ headless: true });
          browser
            .then(() => spinner.succeed("Started Puppeteer!"))
            .catch(() => spinner.fail("Failed to start Puppeteer!"));
          return browser;
        },
        onDone: {
          target: "site",
          actions: assign({
            browser: (_, event) => {
              return event.data;
            },
          }),
        },
      },
    },
    exit: {
      type: "final",
      entry: actions.log("Goodbye!"),
      invoke: {
        src: (context) => Promise.all([proxy.stop(), context.browser!.close()]),
      },
    },
    site: {
      invoke: {
        id: "selectSite",
        src: async () => {
          const { choice } = await prompts({
            type: "select",
            name: "choice",
            message: "Select website",
            choices: downloaders.map((elem, index) => ({
              title: elem.website,
              value: index,
            })),
          });
          if (choice === undefined) throw new Error("User canceled");
          const selectedDownloader = downloaders[choice];
          const selectedWebsite = selectedDownloader.website
            .trim()
            .toLowerCase();
          return {
            confPrefix: selectedDownloader.website.split(".")[0],
            downloader: selectedDownloader,
            loginUsingAuthorization: selectedWebsite === "bmc.io.vn",
          } as SiteSelectionResult;
        },
        onDone: [
          {
            cond: (_, event) => event.data.loginUsingAuthorization,
            target: "loginUsingAuthorization",
            actions: assign({
              confPrefix: (_, event) => event.data.confPrefix,
              downloader: (_, event) => event.data.downloader,
            }),
          },
          {
            target: "login",
            actions: assign({
              confPrefix: (_, event) => event.data.confPrefix,
              downloader: (_, event) => event.data.downloader,
            }),
          },
        ],
        onError: {
          target: "exit",
          actions: assign({
            confPrefix: (_) => undefined,
            downloader: (_) => undefined,
          }),
        },
      },
    },
    login: {
      invoke: {
        id: "login",
        src: async (context) => {
          let { browser, browserContext, confPrefix, downloader } = context;
          await browserContext?.close();
          const { username, password } = await prompts([
            {
              type: "text",
              name: "username",
              message: "Username",
              initial: config.get(`${confPrefix}.username`) as string,
            },
            {
              type: "password",
              name: "password",
              message: "Password",
              initial: config.get(`${confPrefix}.password`) as string,
            },
          ]);
          if (username === undefined || password === undefined)
            throw new Error("User canceled");
          const spinner = ora("Logging in...").start();
          browserContext = await browser?.createBrowserContext();
          const result = await downloader!.login(
            browserContext!,
            username,
            password,
          );
          if (!result) {
            spinner.fail("Login failed! Check your credentials");
            throw new Error("Login failed");
          } else {
            spinner.succeed("Login success!");
            config.set(`${confPrefix}.username`, username);
            config.set(`${confPrefix}.password`, password);
            return {
              browserContext,
              pageContext: result,
            };
          }
        },
        onDone: {
          target: "download",
          actions: assign({
            browserContext: (_, event) => event.data.browserContext,
            pageContext: (_, event) => event.data.pageContext,
          }),
        },
        onError: {
          actions: [
            assign({
              browserContext: (_) => undefined,
              pageContext: (_) => undefined,
            }),
            actions.choose([
              {
                cond: (_, event) => event.data.message === "Login failed",
                actions: actions.send("FAILED"),
              },
              {
                cond: (_, event) => event.data.message === "User canceled",
                actions: actions.send("CANCELED"),
              },
            ]),
          ],
        },
      },
      on: {
        FAILED: { target: "loginUsingAuthorization" },
        CANCELED: { target: "site" },
      },
    },

    loginUsingAuthorization: {
      invoke: {
        id: "loginUsingAuthorization",
        src: async (context) => {
          let { browser, browserContext, confPrefix, downloader } = context;
          await browserContext?.close();
          const { token } = await prompts([
            {
              type: "text",
              name: "token",
              message: "Token",
              initial: config.get(`${confPrefix}.token`) as string,
            },
          
          ]);
          if (token === undefined )
            throw new Error("User canceled");
          const spinner = ora("Logging in...").start();
          browserContext = await browser?.createBrowserContext();
          const result = await downloader!.loginUsingToken(
            browserContext!,
            token,

          );
          if (!result) {
            spinner.fail("Login failed! Check your credentials");
            throw new Error("Login failed");
          } else {
            spinner.succeed("Login success!");
            config.set(`${confPrefix}.token`, token);
            return {
              browserContext,
              pageContext: result,
            };
          }
        },
        onDone: {
          target: "download",
          actions: assign({
            browserContext: (_, event) => event.data.browserContext,
            pageContext: (_, event) => event.data.pageContext,
          }),
        },
        onError: {
          actions: [
            assign({
              browserContext: (_) => undefined,
              pageContext: (_) => undefined,
            }),
            actions.choose([
              {
                cond: (_, event) => event.data.message === "Login failed",
                actions: actions.send("FAILED"),
              },
              {
                cond: (_, event) => event.data.message === "User canceled",
                actions: actions.send("CANCELED"),
              },
            ]),
          ],
        },
      },
      on: {
        FAILED: { target: "login" },
        CANCELED: { target: "site" },
      },
    },

    download: {
      invoke: {
        id: "download",
        src: async (context) => {
          const { browserContext, pageContext, confPrefix, downloader } =
            context;
          const { link, output } = await prompts([
            {
              type: "text",
              name: "link",
              message: "Link",
            },
            {
              type: "text",
              name: "output",
              message: "Output folder",
              initial: config.get(`${confPrefix}.output`) as string,
            },
          ]);
          if (link === undefined || output === undefined)
            throw new Error("User canceled");
          config.set(`${confPrefix}.output`, output);
          try {
            await downloader!.download(
              browserContext!,
              pageContext,
              link,
              output,
            );
            ora().start().succeed("Download finished!");
          } catch (e) {
            ora()
              .start()
              .fail("Download failed! You might need to login again");
            console.log(e);
            throw e;
          }
        },
        onDone: "download",
        onError: "logout",
      },
    },
    logout: {
      invoke: {
        id: "logout",
        src: async (context) => {
          const { browserContext, pageContext, downloader } = context;
          const spinner = ora("Logging out...").start();
          await downloader!
            .logout(browserContext!, pageContext)
            .catch(() => {});
          spinner.succeed("Logged out!");
          await browserContext!.close();
        },
        onDone: {
          target: "site",
          actions: assign({
            browserContext: (_) => undefined,
            pageContext: (_) => undefined,
          }),
        },
      },
    },
  },
});

const service = interpret(machine);
await new Promise<void>((resolve) => service.onStop(resolve).start());
