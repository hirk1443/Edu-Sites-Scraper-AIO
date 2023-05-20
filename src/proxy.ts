import mockttp from "mockttp";
import ora from "ora";

const cert = await mockttp.generateCACertificate();

const spinner = ora("Starting proxy server...").start();
const proxy = mockttp.getLocal({ https: cert, maxBodySize: 1*1024*1024 });
proxy.forUnmatchedRequest().thenPassThrough();
await proxy.start();
spinner.succeed("Started proxy server at " + proxy.url);

export { proxy };
