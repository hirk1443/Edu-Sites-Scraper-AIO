import mockttp from "mockttp";
import ora from "ora";

const cert = await mockttp.generateCACertificate();

const spinner = ora("Starting proxy server...").start();
const proxy = mockttp.getLocal({ https: cert });
proxy.forUnmatchedRequest().thenPassThrough();
await proxy.start(30000);

spinner.succeed("Started proxy server at " + proxy.url);

export { proxy };
